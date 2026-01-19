require(“dotenv”).config();
const { Client, GatewayIntentBits } = require(“discord.js”);
const express = require(“express”);

/* ================== APP KEEP ALIVE ================== */
const app = express();
const PORT = process.env.PORT || 3000;
app.get(”/”, (_, res) => res.send(“✅ Bot đang hoạt động”));
app.listen(PORT, () => console.log(`🌐 Keep-alive port ${PORT}`));

/* ================== DISCORD CLIENT ================== */
const client = new Client({
intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

/* ================== ROLE CONFIG ================== */
const SPECIAL_ROLES = [“1426522399645634691”, “1411991634194989096”];

const BLOCKED_CHANNELS = [
“1423207293335371776”,
“1419725921363034123”,
“1419989424904736880”,
“1419727338119368784”,
“1419727361062076418”,
“1446868843652845608”
];

const ALLOWED_CHANNELS = [
“1411043248406794461”,
“1411043297694060614”,
“1411994491858063380”,
“1411049384816148643”,
“1411049568979648553”,
“1445395166666952714”
];

/* ================== GET CHANNEL (FETCH IF NOT CACHED) ================== */
async function getChannel(guild, channelId) {
let channel = guild.channels.cache.get(channelId);
if (!channel) {
try {
channel = await guild.channels.fetch(channelId);
} catch (err) {
console.error(`❌ Không thể fetch kênh ${channelId}:`, err.message);
return null;
}
}
return channel;
}

/* ================== APPLY PERMISSIONS ================== */
async function applyUserPermissions(member) {
try {
const guild = member.guild;
const hasSpecialRole = member.roles.cache.hasAny(…SPECIAL_ROLES);

```
if (!hasSpecialRole) {
  // Không có role đặc biệt -> xóa tất cả overwrites của user
  const allChannels = [...BLOCKED_CHANNELS, ...ALLOWED_CHANNELS];
  
  for (const chId of allChannels) {
    const channel = await getChannel(guild, chId);
    if (!channel) {
      console.warn(`⚠️ Không tìm thấy kênh ${chId}`);
      continue;
    }
    
    const overwrite = channel.permissionOverwrites.cache.get(member.id);
    if (overwrite) {
      try {
        await channel.permissionOverwrites.delete(member.id);
        console.log(`🔓 Xóa overwrite ${member.user.tag} khỏi ${channel.name}`);
      } catch (err) {
        console.error(`❌ Lỗi xóa overwrite ${channel.name}:`, err.message);
      }
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return;
}

// Có role đặc biệt -> áp dụng quyền
console.log(`🔄 Áp dụng quyền cho ${member.user.tag}...`);

// Chặn các kênh blocked
for (const chId of BLOCKED_CHANNELS) {
  const channel = await getChannel(guild, chId);
  if (!channel) {
    console.warn(`⚠️ Không tìm thấy kênh blocked ${chId}`);
    continue;
  }
  
  try {
    await channel.permissionOverwrites.edit(member.id, { ViewChannel: false });
    console.log(`🔒 Chặn ${member.user.tag} khỏi ${channel.name} (${chId})`);
  } catch (err) {
    console.error(`❌ Lỗi chặn ${channel.name}:`, err.message);
  }
  await new Promise(r => setTimeout(r, 300));
}

// Cho phép các kênh allowed
for (const chId of ALLOWED_CHANNELS) {
  const channel = await getChannel(guild, chId);
  if (!channel) {
    console.warn(`⚠️ Không tìm thấy kênh allowed ${chId}`);
    continue;
  }
  
  try {
    await channel.permissionOverwrites.edit(member.id, { ViewChannel: true });
    console.log(`✅ Cho phép ${member.user.tag} xem ${channel.name} (${chId})`);
  } catch (err) {
    console.error(`❌ Lỗi cho phép ${channel.name}:`, err.message);
  }
  await new Promise(r => setTimeout(r, 300));
}
```

} catch (err) {
console.warn(`⚠️ Lỗi apply permissions ${member.user.tag}:`, err.message);
}
}

/* ================== CLEAN ALL OVERWRITES ================== */
async function cleanAllOverwrites(guild) {
console.log(“🧹 Xóa tất cả overwrites của user trong các kênh…”);
const allChannels = […BLOCKED_CHANNELS, …ALLOWED_CHANNELS];

for (const chId of allChannels) {
const channel = await getChannel(guild, chId);
if (!channel) {
console.warn(`⚠️ Không tìm thấy kênh ${chId} khi clean`);
continue;
}

```
const tasks = [];
for (const [id, ow] of channel.permissionOverwrites.cache) {
  if (ow.type === 1) { // Type 1 = User overwrite
    tasks.push(channel.permissionOverwrites.delete(id));
  }
}

if (tasks.length > 0) {
  await Promise.allSettled(tasks);
  console.log(`🧹 Xóa ${tasks.length} overwrites từ ${channel.name}`);
}
```

}
}

/* ================== COUNTER ================== */
async function updateCounters(online = true) {
try {
const guild = await client.guilds.fetch(process.env.GUILD_ID);
const members = await guild.members.fetch();

```
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
```

} catch (e) {
console.warn(“⚠️ Counter error:”, e.message);
}
}

/* ================== EVENTS ================== */
client.on(“guildMemberAdd”, async member => {
if (member.user.bot) return;
await applyUserPermissions(member);
await updateCounters(true);
});

client.on(“guildMemberUpdate”, async (oldMember, newMember) => {
if (newMember.user.bot) return;
if (oldMember.roles.cache.equals(newMember.roles.cache)) return;
await applyUserPermissions(newMember);
});

client.once(“ready”, async () => {
console.log(`✅ Bot đăng nhập: ${client.user.tag}`);

const guild = await client.guilds.fetch(process.env.GUILD_ID);
await guild.members.fetch();

// Bước 1: Xóa tất cả overwrites
await cleanAllOverwrites(guild);

// Bước 2: Quét và áp dụng quyền cho members có role
console.log(“🔄 Quét và áp dụng quyền cho members…”);
for (const [, member] of guild.members.cache) {
if (!member.user.bot) {
await applyUserPermissions(member);
// Delay nhẹ để tránh rate limit
await new Promise(r => setTimeout(r, 100));
}
}

await updateCounters(true);

// Update counter mỗi 5 phút
setInterval(() => updateCounters(true), 5 * 60 * 1000);
});

/* ================== SAFE SHUTDOWN ================== */
async function shutdown() {
console.log(“⏹️ Shutdown…”);
await updateCounters(false);
process.exit(0);
}

process.on(“SIGINT”, shutdown);
process.on(“SIGTERM”, shutdown);

/* ================== LOGIN ================== */
if (!process.env.TOKEN) {
console.error(“❌ Thiếu TOKEN trong .env”);
} else {
client.login(process.env.TOKEN);
}
