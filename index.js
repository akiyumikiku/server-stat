require("dotenv").config();
const { Client, GatewayIntentBits, PermissionFlagsBits } = require("discord.js");
const express = require("express");

const app = express();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
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
    roleId: "1411991634194989096", // đặc biệt: có role này thì chặn
    blockedChannels: [
      "1423207293335371776", "1419725921363034123",
      "1419989424904736880", "1419727338119368784",
      "1419727361062076418"
    ]
  }
];

// ====== CẬP NHẬT COUNTER ======
async function updateCounters(online = true) {
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const members = await guild.members.fetch();

    const chAll = await guild.channels.fetch(process.env.CH_ALL).catch(() => null);
    const chMembers = await guild.channels.fetch(process.env.CH_MEMBERS).catch(() => null);
    const chServer = await guild.channels.fetch(process.env.CH_SERVER).catch(() => null);

    if (!chAll || !chMembers || !chServer) {
      console.log("⚠️ Không tìm thấy channel counter.");
      return;
    }

    const total = guild.memberCount;
    const humans = members.filter(m => !m.user.bot).size;

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

// ====== QUÉT VÀ ĐỒNG BỘ QUYỀN KÊNH (chỉ chạm vào user, không đụng role) ======
async function scanChannelsOnce(guild) {
  console.log("🔍 Đang quét và đồng bộ quyền kênh theo topic...");

  const channels = await guild.channels.fetch();
  let fixed = 0;

  for (const [_, channel] of channels) {
    if (!channel?.isTextBased?.() || channel.type === 4) continue;
    if (channel.parentId === "1433101513915367638") continue; // ngoại lệ ticket support

    const topic = channel.topic || "";
    const match = topic.match(/\b(\d{17,20})\b/);
    const overwrites = channel.permissionOverwrites?.cache || new Map();

    if (match) {
      const userId = match[1];
      try {
        // Thêm quyền cho user trong topic
        await channel.permissionOverwrites.edit(userId, { ViewChannel: true }).catch(() => {});

        // Xóa quyền cá nhân khác (user khác) nhưng KHÔNG đụng role
        for (const [targetId, overwrite] of overwrites) {
          if (overwrite.type === 1 && targetId !== userId) {
            await channel.permissionOverwrites.delete(targetId).catch(() => {});
          }
        }

        console.log(`✅ Giữ riêng quyền ${channel.name} cho user ${userId}`);
        fixed++;
      } catch (err) {
        console.warn(`⚠️ Lỗi xử lý ${channel.name}:`, err.message);
      }
    }
  }

  console.log(`✅ Hoàn tất quét ${fixed} kênh có topic user.`);
}

// ====== HÀM CHẶN KÊNH THEO ROLE ======
async function applyRoleRestrictions(member) {
  try {
    for (const cfg of ROLE_BLOCK_MAP) {
      const hasRole = member.roles.cache.has(cfg.roleId);
      const isSpecial = cfg.roleId === "1411991634194989096";

      for (const chId of cfg.blockedChannels) {
        const ch = await member.guild.channels.fetch(chId).catch(() => null);
        if (!ch) continue;

        if (isSpecial) {
          // ✅ ĐẶC BIỆT: có role → chặn
          if (hasRole)
            await ch.permissionOverwrites.edit(member.id, { ViewChannel: false }).catch(() => {});
          else {
            const ow = ch.permissionOverwrites?.cache.get(member.id);
            if (ow) await ch.permissionOverwrites.delete(member.id).catch(() => {});
          }
        } else {
          // ✅ CÁC ROLE CÒN LẠI: KHÔNG có role → chặn
          if (!hasRole)
            await ch.permissionOverwrites.edit(member.id, { ViewChannel: false }).catch(() => {});
          else {
            const ow = ch.permissionOverwrites?.cache.get(member.id);
            if (ow) await ch.permissionOverwrites.delete(member.id).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️ Lỗi áp dụng hạn chế role cho ${member.user.tag}:`, err.message);
  }
}

// ====== EVENT ======
client.on("guildMemberAdd", async member => {
  if (member.user.bot) return;
  console.log(`👋 Thành viên mới: ${member.user.tag}`);
  await applyRoleRestrictions(member);
  await updateCounters(true);
});

client.on("guildMemberUpdate", async (_, newMember) => {
  if (newMember.user.bot) return;
  await applyRoleRestrictions(newMember);
});

client.once("ready", async () => {
  console.log(`✅ Bot đăng nhập: ${client.user.tag}`);

  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await guild.members.fetch();

  // ⭐ Quét toàn bộ member ngay khi bật bot
  console.log("🔄 Đang quét toàn bộ thành viên để áp dụng quyền role...");
  for (const [_, member] of guild.members.cache) {
    if (member.user.bot) continue;
    await applyRoleRestrictions(member);
  }
  console.log("✅ Hoàn tất quét quyền role cho tất cả thành viên.");

  await scanChannelsOnce(guild); // quét topic
  await updateCounters(true);    // cập nhật counter

  setInterval(() => updateCounters(true), 5 * 60 * 1000);
});

// ====== AUTO RESTART & KEEP ALIVE ======
setInterval(() => {
  console.log("♻️ Restart theo chu kỳ 24h...");
  process.exit(0);
}, 24 * 60 * 60 * 1000);

app.get("/", (req, res) => res.send("✅ Bot đang hoạt động"));
app.listen(PORT, () => console.log(`🌐 Keep-alive port ${PORT}`));

process.on("SIGINT", async () => await updateCounters(false));
process.on("SIGTERM", async () => await updateCounters(false));

if (!process.env.TOKEN) {
  console.error("❌ Thiếu TOKEN trong .env");
} else {
  client.login(process.env.TOKEN).catch(err => console.error("❌ Lỗi đăng nhập:", err));
}
