require("dotenv").config();
const { Client, GatewayIntentBits, PermissionFlagsBits } = require("discord.js");
const express = require("express");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

const app = express();
const PORT = process.env.PORT || 3000;

// ====== Cấu hình role → category ======
const ROLE_CATEGORY_MAP = [
  { roleId: "1410990099042271352", categoryId: "1411043139728314478" },
  { roleId: "1410990099042271352", categoryId: "1411049289685270578" },
  { roleId: "1428899344010182756", categoryId: "1428927402444325024" },
];

// ====== Cấu hình role block kênh ======
const ROLE_BLOCK_CHANNELS = {
  roleId: "1411991634194989096",
  blockedChannels: [
    "1419727338119368784",
    "1419727361062076418",
    "1423207293335371776",
    "1419725921363034123",
    "1419989424904736880",
  ],
};

// Delay nhẹ tránh rate-limit (tùy chỉnh bằng env nếu cần)
const CHANNEL_DELAY_MS = parseInt(process.env.CHANNEL_DELAY_MS || "200", 10);
const MEMBER_DELAY_MS = parseInt(process.env.MEMBER_DELAY_MS || "75", 10);
const delay = ms => new Promise(res => setTimeout(res, ms));

// ====== Counter members ======
async function updateCounters(online = true) {
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await guild.members.fetch();

    const chAll = guild.channels.cache.get(process.env.CH_ALL);
    const chMembers = guild.channels.cache.get(process.env.CH_MEMBERS);
    const chServer = guild.channels.cache.get(process.env.CH_SERVER);

    if (!chAll || !chMembers || !chServer) {
      return console.log("⚠️ Không tìm thấy channel counter (CH_ALL / CH_MEMBERS / CH_SERVER).");
    }

    const total = guild.memberCount;
    const humans = guild.members.cache.filter(m => !m.user.bot).size;

    await Promise.allSettled([
      chAll.setName(`╭ All Members: ${total}`),
      chMembers.setName(`┊ Members: ${humans}`),
      chServer.setName(`╰ Server: ${online ? "🟢 Active" : "🔴 Offline"}`),
    ]);

    console.log(`✅ Counter → Tổng: ${total}, Người: ${humans}, Trạng thái: ${online ? "Online" : "Offline"}`);
  } catch (err) {
    console.error("❌ Lỗi cập nhật counter:", err);
  }
}

// ====== Hàm xử lý visibility theo role → category ======
async function handleRoleVisibility(member, roleId, hasRole) {
  const guild = member.guild;
  const configs = ROLE_CATEGORY_MAP.filter(c => c.roleId === roleId);

  for (const cfg of configs) {
    const category = guild.channels.cache.get(cfg.categoryId);
    if (!category) continue;

    const channels = [...category.children.cache.values()];
    let changedCount = 0;

    for (const channel of channels) {
      try {
        const overwrite = channel.permissionOverwrites.cache.get(member.id);

        if (hasRole) {
          // Có role → xóa member overwrite nếu có deny ViewChannel (khôi phục inheritance)
          if (overwrite && overwrite.deny.has(PermissionFlagsBits.ViewChannel)) {
            await channel.permissionOverwrites.delete(member.id).catch(() => {});
            console.log(`✅ Mở kênh ${channel.name} cho ${member.user.tag}`);
            changedCount++;
          }
        } else {
          // Không role → deny ViewChannel (ẩn riêng người đó)
          await channel.permissionOverwrites.edit(member.id, { ViewChannel: false }).catch(() => {});
          console.log(`🚫 Ẩn kênh ${channel.name} cho ${member.user.tag}`);
          changedCount++;
        }

        await delay(CHANNEL_DELAY_MS);
      } catch (err) {
        console.warn(`⚠️ Lỗi channel ${channel.name}:`, err.message || err);
      }
    }

    if (changedCount > 0) {
      console.log(`📊 ${member.user.tag} - Đã chỉnh ${changedCount} kênh trong danh mục ${category.name}`);
    }
  }
}

// ====== Hàm xử lý block channel (có role -> deny; mất role -> xóa overwrite) ======
async function handleBlockedChannels(member, hasRole) {
  const guild = member.guild;
  let changedCount = 0;

  for (const channelId of ROLE_BLOCK_CHANNELS.blockedChannels) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) continue;

    try {
      const overwrite = channel.permissionOverwrites.cache.get(member.id);

      if (hasRole) {
        // Có role → deny ViewChannel (ẩn)
        await channel.permissionOverwrites.edit(member.id, { ViewChannel: false }).catch(() => {});
        console.log(`🧱 Ẩn ${channel.name} cho ${member.user.tag} (do có role block)`);
        changedCount++;
      } else {
        // Mất role → xóa overwrite (trả về mặc định)
        if (overwrite) {
          await channel.permissionOverwrites.delete(member.id).catch(() => {});
          console.log(`✅ Gỡ block ${channel.name} cho ${member.user.tag} (xoá overwrite)`);
          changedCount++;
        }
      }

      await delay(CHANNEL_DELAY_MS);
    } catch (err) {
      console.warn(`⚠️ Lỗi xử lý block channel ${channelId}:`, err.message || err);
    }
  }

  if (changedCount > 0) {
    console.log(`📊 ${member.user.tag} - Đã chỉnh ${changedCount} kênh trong danh sách block`);
  }
}

// ====== Event role thay đổi ======
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    const allRoleIds = [
      ...new Set(ROLE_CATEGORY_MAP.map(r => r.roleId).concat(ROLE_BLOCK_CHANNELS.roleId))
    ];

    const changed = allRoleIds.filter(
      roleId => oldMember.roles.cache.has(roleId) !== newMember.roles.cache.has(roleId)
    );

    if (!changed.length) return;
    console.log(`⚙️ Role changed for ${newMember.user.tag}:`, changed);

    for (const roleId of changed) {
      const hasRole = newMember.roles.cache.has(roleId);

      if (ROLE_CATEGORY_MAP.some(r => r.roleId === roleId)) {
        await handleRoleVisibility(newMember, roleId, hasRole);
      }

      if (roleId === ROLE_BLOCK_CHANNELS.roleId) {
        await handleBlockedChannels(newMember, hasRole);
      }
    }
  } catch (err) {
    console.error("❌ Lỗi trong guildMemberUpdate handler:", err);
  }
});

// ====== Ready ======
client.once("ready", async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);

  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);

    // Fetch toàn bộ members trước khi làm việc
    await guild.members.fetch();
    console.log(`👥 Fetched ${guild.memberCount} members`);

    // Cập nhật counter khi start
    await updateCounters(true);
    // Lặp cập nhật counter mỗi 5 phút
    setInterval(() => updateCounters(true), 5 * 60 * 1000);

    // Quét toàn bộ member để đồng bộ quyền
    console.log("⚙️ Quét toàn bộ member để đồng bộ quyền...");
    const members = guild.members.cache.filter(m => !m.user.bot);
    let processed = 0;
    for (const member of members.values()) {
      const allRoleIds = [...new Set(ROLE_CATEGORY_MAP.map(r => r.roleId).concat(ROLE_BLOCK_CHANNELS.roleId))];
      for (const roleId of allRoleIds) {
        const hasRole = member.roles.cache.has(roleId);
        if (ROLE_CATEGORY_MAP.some(r => r.roleId === roleId)) {
          await handleRoleVisibility(member, roleId, hasRole);
        }
        if (roleId === ROLE_BLOCK_CHANNELS.roleId) {
          await handleBlockedChannels(member, hasRole);
        }
      }
      processed++;
      if (processed % 20 === 0) console.log(`⏱️ Đã xử lý ${processed}/${members.size} members...`);
      await delay(MEMBER_DELAY_MS); // tránh spike requests
    }
    console.log("✅ Hoàn tất quét tất cả member!");
  } catch (err) {
    console.error("❌ Lỗi fetch/quét members:", err);
  }
});

// ====== Keep-alive endpoint ======
app.get("/", (req, res) => res.send("✅ Bot is alive"));
app.listen(PORT, () => console.log(`🌐 Keep-alive running on port ${PORT}`));

// ====== AUTO RESTART THEO CHU KỲ ======
// 🕒 Đặt số giờ bot tự khởi động lại (ví dụ: 6 = mỗi 6 tiếng)
const RESTART_INTERVAL_HOURS = 24;

// Chuyển sang mili giây để setInterval chạy đúng
const RESTART_INTERVAL = RESTART_INTERVAL_HOURS * 60 * 60 * 24;

// In log để biết bot đang đếm giờ restart
console.log(`🕒 Bot sẽ tự khởi động lại sau ${RESTART_INTERVAL_HOURS} tiếng.`);

// Bắt đầu bộ đếm
setInterval(() => {
  console.log(`♻️ Auto-Restart: Đã đến ${RESTART_INTERVAL_HOURS} tiếng, bot sẽ khởi động lại...`);
  process.exit(0); // Render sẽ tự restart container ngay sau khi process kết thúc
}, RESTART_INTERVAL);

// ====== Graceful signals: chỉ update counter chứ không exit ======
process.on("SIGINT", async () => {
  console.log("⚠️ Received SIGINT - updating counter to Offline (no exit).");
  try { await updateCounters(false); } catch (e) {}
});
process.on("SIGTERM", async () => {
  console.log("⚠️ Received SIGTERM - updating counter to Offline (no exit).");
  try { await updateCounters(false); } catch (e) {}
});

// ====== Login bot (debug if missing token) ======
if (!process.env.TOKEN) {
  console.error("❌ ERROR: TOKEN not found! Set TOKEN in environment variables.");
} else {
  console.log("🔑 TOKEN loaded, attempting login...");
  client.login(process.env.TOKEN).catch(err => {
    console.error("❌ Bot login failed:", err);
  });
}
