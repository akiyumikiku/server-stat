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
    roleId: "1410990099042271352", // role 1 → KHÔNG có role thì bị chặn
    blockedChannels: [
      "1411043248406794461", "1423207293335371776", "1411043297694060614",
      "1419725921363034123", "1411994491858063380", "1419989424904736880",
      "1419727338119368784", "1419727361062076418", "1411049384816148643",
      "1411049568979648553"
    ]
  },
  {
    roleId: "1428899344010182756", // role 2 → KHÔNG có role thì bị chặn
    blockedChannels: ["1427958980059336774", "1431550495683514439"]
  },
  {
    roleId: "1411991634194989096", // role 3 → CÓ role thì bị chặn
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

// ====== QUÉT VÀ ĐỒNG BỘ QUYỀN KÊNH ======
async function scanChannelsOnce(guild) {
  console.log("🔍 Đang quét và đồng bộ quyền kênh theo topic...");

  const channels = await guild.channels.fetch();
  let fixed = 0;

  for (const [_, channel] of channels) {
    if (!channel?.isTextBased?.() || channel.type === 4) continue;
    if (channel.parentId === "1433101513915367638") continue; // ngoại lệ ticket support

    const topic = channel.topic || "";
    // Giả sử topic dạng: username iduser
    const match = topic.match(/\b(\d{17,20})\b/);
    const overwrites = channel.permissionOverwrites?.cache || new Map();

    if (match) {
      const userId = match[1];
      try {
        // Xóa hết quyền của người khác
        for (const [targetId] of overwrites) {
          if (targetId !== userId)
            await channel.permissionOverwrites.delete(targetId).catch(() => {});
        }
        // Giữ lại cho đúng user
        await channel.permissionOverwrites.edit(userId, { ViewChannel: true }).catch(() => {});
        console.log(`✅ Giữ riêng ${channel.name} cho ${userId}`);
        fixed++;
      } catch (err) {
        console.warn(`⚠️ Lỗi xử lý kênh ${channel.name}:`, err.message);
      }
    } else {
      // Nếu không có user trong topic → xóa quyền member cá nhân
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
        const ch = await member.guild.channels.fetch(chId).catch(() => null);
        if (!ch) continue;

        // --- Role đặc biệt: có thì CHẶN ---
        if (cfg.roleId === "1411991634194989096") {
          if (hasRole) {
            await ch.permissionOverwrites.edit(member.id, { ViewChannel: false }).catch(() => {});
            console.log(`🚫 ${member.user.tag} bị ẩn ${ch.name} (có role đặc biệt)`);
          } else {
            const ow = ch.permissionOverwrites?.cache.get(member.id);
            if (ow) await ch.permissionOverwrites.delete(member.id).catch(() => {});
            console.log(`✅ ${member.user.tag} được mở ${ch.name} (mất role đặc biệt)`);
          }
        }

        // --- Các role còn lại: không có thì CHẶN ---
        else {
          if (!hasRole) {
            await ch.permissionOverwrites.edit(member.id, { ViewChannel: false }).catch(() => {});
            console.log(`🚫 ${member.user.tag} bị chặn ${ch.name} (thiếu role ${cfg.roleId})`);
          } else {
            const ow = ch.permissionOverwrites?.cache.get(member.id);
            if (ow) await ch.permissionOverwrites.delete(member.id).catch(() => {});
            console.log(`✅ ${member.user.tag} được mở ${ch.name} (có role ${cfg.roleId})`);
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

  // ⭐ Quét toàn bộ member khi khởi động để đảm bảo đồng bộ quyền
  console.log("🔄 Đang quét toàn bộ thành viên để áp dụng quyền role...");
  for (const [_, member] of guild.members.cache) {
    if (member.user.bot) continue;
    await applyRoleRestrictions(member);
  }
  console.log("✅ Hoàn tất quét quyền role cho tất cả thành viên.");

  await scanChannelsOnce(guild);  // Quét channel có topic
  await updateCounters(true);     // Cập nhật counter

  // Cập nhật counter mỗi 5 phút
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
