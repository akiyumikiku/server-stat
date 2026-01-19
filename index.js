require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const express = require("express");

/* ================== APP KEEP ALIVE ================== */
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (_, res) => res.send("✅ Bot đang hoạt động"));
app.listen(PORT, () => console.log(`🌐 Keep-alive port ${PORT}`));

/* ================== DISCORD CLIENT ================== */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

/* ================== ROLE BLOCK CONFIG ================== */

// Những role: CÓ → BỊ CHẶN
const SPECIAL_BLOCK_ROLES = [
  "1411991634194989096",
  "1426522399645634691"
];

const ROLE_BLOCK_MAP = [
  {
    roleId: "1410990099042271352",
    blockedChannels: [
      "1411043248406794461",
      "1423207293335371776",
      "1411043297694060614",
      "1419725921363034123",
      "1411994491858063380",
      "1419989424904736880",
      "1419727338119368784",
      "1419727361062076418",
      "1411049384816148643",
      "1411049568979648553"
    ]
  },
  {
    roleId: "1428899344010182756",
    blockedChannels: [
      "1427958980059336774",
      "1431550495683514439"
    ]
  },
  {
    roleId: "1411991634194989096",
    blockedChannels: [
      "1423207293335371776",
      "1419725921363034123",
      "1419989424904736880",
      "1419727338119368784",
      "1419727361062076418"
    ]
  },
  {
    roleId: "1426522399645634691",
    blockedChannels: [
      "1419727338119368784",
      "1419727361062076418",
      "1446868843652845608"
    ]
  }
];

/* ================== OVERWRITE QUEUE (ANTI RATE-LIMIT) ================== */
const overwriteQueue = [];
let queueRunning = false;

async function runQueue() {
  if (queueRunning) return;
  queueRunning = true;

  while (overwriteQueue.length) {
    const task = overwriteQueue.shift();
    try {
      await task();
    } catch {}
    await new Promise(r => setTimeout(r, 350));
  }

  queueRunning = false;
}

function enqueue(task) {
  overwriteQueue.push(task);
  runQueue();
}

/* ================== APPLY ROLE RESTRICTIONS ================== */
async function applyRoleRestrictions(member) {
  try {
    const guild = member.guild;
    const channelCache = guild.channels.cache;

    for (const cfg of ROLE_BLOCK_MAP) {
      const hasRole = member.roles.cache.has(cfg.roleId);
      const isSpecial = SPECIAL_BLOCK_ROLES.includes(cfg.roleId);

      for (const chId of cfg.blockedChannels) {
        const channel = channelCache.get(chId);
        if (!channel) continue;

        const overwrite = channel.permissionOverwrites.cache.get(member.id);
        const shouldBlock = isSpecial ? hasRole : !hasRole;

        if (shouldBlock && !overwrite) {
          enqueue(async () => {
            await channel.permissionOverwrites.edit(member.id, {
              ViewChannel: false
            });
            console.log(`🔒 ${member.user.tag} bị chặn ${channel.name} (role ${cfg.roleId})`);
          });
        }

        if (!shouldBlock && overwrite) {
          enqueue(async () => {
            await channel.permissionOverwrites.delete(member.id);
            console.log(`🔓 ${member.user.tag} mở lại ${channel.name}`);
          });
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️ Lỗi apply role ${member.user.tag}:`, err.message);
  }
}

/* ================== SCAN CHANNEL TOPIC ================== */
async function scanChannelsOnce(guild) {
  console.log("🔍 Quét kênh theo topic user...");
  const channels = await guild.channels.fetch();

  for (const [, channel] of channels) {
    if (!channel?.isTextBased?.()) continue;
    if (!channel.topic) continue;

    const match = channel.topic.match(/\b(\d{17,20})\b/);
    if (!match) continue;

    const userId = match[1];
    const memberExists = await guild.members.fetch(userId).catch(() => null);

    if (!memberExists) {
      await channel.permissionOverwrites.delete(userId).catch(() => {});
      console.log(`🧹 Xoá overwrite user rời server khỏi ${channel.name}`);
      continue;
    }

    await channel.permissionOverwrites.edit(userId, { ViewChannel: true }).catch(() => {});

    for (const [id, ow] of channel.permissionOverwrites.cache) {
      if (ow.type === 1 && id !== userId) {
        await channel.permissionOverwrites.delete(id).catch(() => {});
      }
    }
  }
}

/* ================== COUNTER ================== */
async function updateCounters(online = true) {
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const members = await guild.members.fetch();

    const chAll = await guild.channels.fetch(process.env.CH_ALL).catch(() => null);
    const chMembers = await guild.channels.fetch(process.env.CH_MEMBERS).catch(() => null);
    const chServer = await guild.channels.fetch(process.env.CH_SERVER).catch(() => null);
    if (!chAll || !chMembers || !chServer) return;

    const total = guild.memberCount;
    const humans = members.filter(m => !m.user.bot).size;

    await Promise.allSettled([
      chAll.setName(`╭ All Members: ${total}`),
      chMembers.setName(`┊ Members: ${humans}`),
      chServer.setName(`╰ Server: ${online ? "🟢 Active" : "🔴 Offline"}`)
    ]);
  } catch (e) {
    console.warn("⚠️ Counter error:", e.message);
  }
}

/* ================== EVENTS ================== */
client.on("guildMemberAdd", async member => {
  if (member.user.bot) return;
  await applyRoleRestrictions(member);
  await updateCounters(true);
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  if (newMember.user.bot) return;
  if (oldMember.roles.cache.equals(newMember.roles.cache)) return;
  await applyRoleRestrictions(newMember);
});

client.once("ready", async () => {
  console.log(`✅ Bot đăng nhập: ${client.user.tag}`);

  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await guild.members.fetch();

  console.log("🔄 Quét toàn bộ member...");
  for (const [, member] of guild.members.cache) {
    if (!member.user.bot) await applyRoleRestrictions(member);
  }

  await scanChannelsOnce(guild);
  await updateCounters(true);

  setInterval(() => updateCounters(true), 5 * 60 * 1000);
});

/* ================== SAFE SHUTDOWN ================== */
async function shutdown() {
  console.log("⏹️ Shutdown...");
  await updateCounters(false);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

/* ================== LOGIN ================== */
if (!process.env.TOKEN) {
  console.error("❌ Thiếu TOKEN trong .env");
} else {
  client.login(process.env.TOKEN);
}
