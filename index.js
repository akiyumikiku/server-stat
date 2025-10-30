require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const express = require("express");

const app = express();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

const PORT = process.env.PORT || 3000;

// ====== CẤU HÌNH ROLE CHẶN KÊNH ======
const ROLE_BLOCK_MAP = [
  {
    roleId: "1410990099042271352",
    blockedChannels: [
      "1411043248406794461", "1423207293335371776", "1411043297694060614",
      "1419725921363034123", "1411994491858063380", "1419989424904736880",
      "1419727338119368784", "1419727361062076418", "1411049384816148643",
      "1411049568979648553"
    ]
  },
  {
    roleId: "1428899344010182756",
    blockedChannels: ["1427958980059336774", "1431550495683514439"]
  },
  {
    roleId: "1411991634194989096",
    blockedChannels: [
      "1419727338119368784", "1419727361062076418",
      "1423207293335371776", "1419725921363034123",
      "1419989424904736880"
    ]
  }
];

// ====== CẬP NHẬT COUNTER ======
async function updateCounters(online = true) {
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
    if (!guild) return console.log("⚠️ Không thể fetch guild để cập nhật counter.");

    await guild.members.fetch();

    const chAll = guild.channels.cache.get(process.env.CH_ALL);
    const chMembers = guild.channels.cache.get(process.env.CH_MEMBERS);
    const chServer = guild.channels.cache.get(process.env.CH_SERVER);

    if (!chAll || !chMembers || !chServer)
      return console.log("⚠️ Không tìm thấy channel counter.");

    const total = guild.memberCount;
    const humans = guild.members.cache.filter(m => !m.user.bot).size;

    await Promise.allSettled([
      chAll.setName(`╭ All Members: ${total}`),
      chMembers.setName(`┊ Members: ${humans}`),
      chServer.setName(`╰ Server: ${online ? "🟢 Active" : "🔴 Offline"}`)
    ]);

    console.log(`✅ Counter cập nhật → Tổng: ${total}, Người: ${humans}`);
  } catch (err) {
    console.error("❌ Lỗi cập nhật counter:", err);
  }
}

// ====== XỬ LÝ QUYỀN KÊNH THEO TOPIC (CHỈ CHẠY MỘT LẦN) ======
async function scanChannelsOnce(guild) {
  if (!guild) {
    console.warn("⚠️ scanChannelsOnce: guild bị undefined, bỏ qua.");
    return;
  }

  const channelsManager = guild.channels;
  if (!channelsManager?.cache) {
    console.warn("⚠️ guild.channels.cache chưa sẵn sàng, thử lại sau...");
    return;
  }

  console.log("🔍 Đang quét và đồng bộ quyền kênh theo topic...");

  const textChannels = channelsManager.cache.filter(
    ch => ch.isTextBased() && ch.type !== 4
  );

  let fixed = 0;

  for (const channel of textChannels.values()) {
    // Bỏ qua danh mục ticket support
    if (channel.parentId === "1433101513915367638") continue;

    const topic = channel.topic || "";
    const match = topic.match(/\(user\s*-\s*(\d+)\)/i);
    const overwrites = channel.permissionOverwrites?.cache;
    if (!overwrites) continue;

    if (match) {
      const userId = match[1];
      try {
        // Xóa quyền riêng của người khác, chỉ giữ người trong topic
        for (const [targetId] of overwrites) {
          if (targetId !== userId)
            await channel.permissionOverwrites.delete(targetId).catch(() => {});
        }
        await channel.permissionOverwrites.edit(userId, { ViewChannel: true }).catch(() => {});
        console.log(`✅ Giữ riêng ${channel.name} cho ${userId}`);
        fixed++;
      } catch (err) {
        console.warn(`⚠️ Lỗi xử lý kênh ${channel.name}:`, err.message);
      }
    } else {
      // Nếu không có topic user thì xóa hết quyền riêng user
      for (const [targetId, overwrite] of overwrites) {
        if (overwrite.type === 1)
          await channel.permissionOverwrites.delete(targetId).catch(() => {});
      }
    }
  }

  console.log(`✅ Hoàn tất quét ${fixed} kênh có gắn topic user.`);
}

// ====== HÀM CHẶN KÊNH THEO ROLE ======
async function applyRoleRestrictions(member) {
  try {
    for (const cfg of ROLE_BLOCK_MAP) {
      const hasRole = member.roles.cache.has(cfg.roleId);
      for (const chId of cfg.blockedChannels) {
        const ch = member.guild.channels.cache.get(chId);
        if (!ch) continue;

        if (!hasRole) {
          await ch.permissionOverwrites.edit(member.id, { ViewChannel: false }).catch(() => {});
        } else {
          const ow = ch.permissionOverwrites.cache.get(member.id);
          if (ow) await ch.permissionOverwrites.delete(member.id).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️ Lỗi áp dụng hạn chế role cho ${member.user.tag}:`, err.message);
  }
}

// ====== EVENT: MEMBER JOIN ======
client.on("guildMemberAdd", async member => {
  if (member.user.bot) return;
  console.log(`👋 Thành viên mới: ${member.user.tag}`);
  await applyRoleRestrictions(member);
  await updateCounters(true);
});

// ====== EVENT: MEMBER UPDATE ROLE ======
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  if (newMember.user.bot) return;
  await applyRoleRestrictions(newMember);
});

// ====== READY ======
client.once("ready", async () => {
  console.log(`✅ Bot đăng nhập: ${client.user.tag}`);

  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
  if (!guild) return console.error("❌ Không thể fetch guild. Kiểm tra GUILD_ID hoặc quyền bot.");

  await guild.members.fetch();

  await scanChannelsOnce(guild);
  await updateCounters(true);

  // Cập nhật counter định kỳ mỗi 5 phút
  setInterval(() => updateCounters(true), 5 * 60 * 1000);
});

// ====== AUTO RESTART ======
setInterval(() => {
  console.log("♻️ Restart theo chu kỳ 24h...");
  process.exit(0);
}, 24 * 60 * 60 * 1000);

// ====== KEEP ALIVE ======
app.get("/", (req, res) => res.send("✅ Bot đang hoạt động"));
app.listen(PORT, () => console.log(`🌐 Keep-alive port ${PORT}`));

// ====== SIGNALS ======
process.on("SIGINT", async () => await updateCounters(false));
process.on("SIGTERM", async () => await updateCounters(false));

// ====== LOGIN ======
if (!process.env.TOKEN) {
  console.error("❌ Thiếu TOKEN trong .env");
} else {
  client.login(process.env.TOKEN).catch(err => console.error("❌ Lỗi đăng nhập:", err));
}
