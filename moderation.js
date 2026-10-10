
const fs = require("fs");
const path = require("path");
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField
} = require("discord.js");

const warningsFile = path.join(__dirname, "warnings.json");

function loadWarnings() {
  try {
    if (!fs.existsSync(warningsFile)) {
      fs.writeFileSync(warningsFile, "{}", "utf8");
    }

    const data = JSON.parse(
      fs.readFileSync(warningsFile, "utf8")
    );

    return data && typeof data === "object" ? data : {};
  } catch (error) {
    console.error("WARNINGS LOAD ERROR:", error);
    return {};
  }
}

let warnings = loadWarnings();

function saveWarnings() {
  const temporaryFile = `${warningsFile}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(warnings, null, 2),
    "utf8"
  );

  fs.renameSync(temporaryFile, warningsFile);
}

function isOwner(interaction) {
  return (
    interaction.guild &&
    interaction.user.id === interaction.guild.ownerId
  );
}

function canModerate(interaction) {
  if (!interaction.guild) return false;
  if (isOwner(interaction)) return true;

  return interaction.memberPermissions?.has(
    PermissionsBitField.Flags.Administrator
  ) ||
  interaction.memberPermissions?.has(
    PermissionsBitField.Flags.ManageMessages
  );
}

function getMemberWarnings(guildId, userId) {
  if (!warnings[guildId]) {
    warnings[guildId] = {};
  }

  if (!Array.isArray(warnings[guildId][userId])) {
    warnings[guildId][userId] = [];
  }

  return warnings[guildId][userId];
}

const commands = [
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a server member")
    .addUserOption(option =>
      option
        .setName("mention")
        .setDescription("Member to warn")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason for the warning")
        .setRequired(true)
        .setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName("warnr")
    .setDescription("Remove warnings from a member or the whole server")
    .addUserOption(option =>
      option
        .setName("mention")
        .setDescription("Member whose warnings you want to remove")
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName("all")
        .setDescription("Remove warnings from every member")
        .setRequired(false)
    )
].map(command => command.toJSON());

async function handleInteraction(interaction) {
  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "warn"
  ) {
    if (!canModerate(interaction)) {
      await interaction.reply({
        content: "❌ هذا الأمر للمشرفين والـ Owner فقط.",
        ephemeral: true
      });
      return true;
    }

    const target = interaction.options.getUser("mention", true);
    const reason = interaction.options.getString("reason", true);

    if (target.bot) {
      await interaction.reply({
        content: "❌ ما تقدر تحذر بوت.",
        ephemeral: true
      });
      return true;
    }

    if (target.id === interaction.user.id) {
      await interaction.reply({
        content: "❌ ما تقدر تحذر نفسك.",
        ephemeral: true
      });
      return true;
    }

    if (target.id === interaction.guild.ownerId) {
      await interaction.reply({
        content: "❌ ما تقدر تحذر Owner السيرفر.",
        ephemeral: true
      });
      return true;
    }

    const targetMember = await interaction.guild.members
      .fetch(target.id)
      .catch(() => null);

    if (!targetMember) {
      await interaction.reply({
        content: "❌ العضو غير موجود في السيرفر.",
        ephemeral: true
      });
      return true;
    }

    const memberWarnings = getMemberWarnings(
      interaction.guild.id,
      target.id
    );

    const warning = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      reason,
      moderatorId: interaction.user.id,
      timestamp: new Date().toISOString()
    };

    memberWarnings.push(warning);

    try {
      saveWarnings();
    } catch (error) {
      memberWarnings.pop();

      console.error("WARNING SAVE ERROR:", error);

      await interaction.reply({
        content: "❌ تعذر حفظ التحذير. حاول مرة ثانية.",
        ephemeral: true
      });

      return true;
    }

    const embed = new EmbedBuilder()
      .setTitle("⚠️ MEMBER WARNING")
      .setColor(0xed4245)
      .setDescription(
        `**Member:** <@${target.id}>\n` +
        `**Moderator:** <@${interaction.user.id}>\n` +
        `**Reason:** ${reason}\n` +
        `**Total warnings:** ${memberWarnings.length}`
      )
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      allowedMentions: {
        users: [target.id, interaction.user.id]
      }
    });

    return true;
  }

  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "warnr"
  ) {
    if (!canModerate(interaction)) {
      await interaction.reply({
        content: "❌ هذا الأمر للمشرفين والـ Owner فقط.",
        ephemeral: true
      });
      return true;
    }

    const target = interaction.options.getUser("mention");
    const removeAll = interaction.options.getBoolean("all") ?? false;

    if (Boolean(target) === removeAll) {
      await interaction.reply({
        content:
          "❌ اختر عضوًا في `mention` أو اجعل `all` = `True`، وليس الاثنين معًا.",
        ephemeral: true
      });
      return true;
    }

    const guildId = interaction.guild.id;

    if (removeAll) {
      const total = Object.values(warnings[guildId] || {})
        .reduce(
          (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
          0
        );

      if (total === 0) {
        await interaction.reply({
          content: "✅ ما فيه تحذيرات محفوظة في السيرفر.",
          ephemeral: true
        });
        return true;
      }

      const confirmButton = new ButtonBuilder()
        .setCustomId(`warnr_all_confirm_${interaction.user.id}`)
        .setLabel("تأكيد مسح الكل")
        .setStyle(ButtonStyle.Danger);

      const cancelButton = new ButtonBuilder()
        .setCustomId(`warnr_all_cancel_${interaction.user.id}`)
        .setLabel("إلغاء")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(
        confirmButton,
        cancelButton
      );

      await interaction.reply({
        content:
          `⚠️ **تأكيد نهائي**\n` +
          `سيتم حذف جميع التحذيرات المسجلة لأعضاء هذا السيرفر.\n` +
          `عدد التحذيرات: **${total}**\n` +
          `هذا الإجراء لا يمكن التراجع عنه.`,
        components: [row],
        ephemeral: true
      });

      return true;
    }

    if (target.bot) {
      await interaction.reply({
        content: "❌ ما تقدر تستخدم هذا الأمر على بوت.",
        ephemeral: true
      });
      return true;
    }

    const memberWarnings = getMemberWarnings(guildId, target.id);
    const removed = memberWarnings.length;

    if (removed === 0) {
      await interaction.reply({
        content: `ℹ️ <@${target.id}> ما عنده تحذيرات محفوظة.`,
        ephemeral: true,
        allowedMentions: { users: [] }
      });
      return true;
    }

    warnings[guildId][target.id] = [];

    try {
      saveWarnings();
    } catch (error) {
      warnings[guildId][target.id] = memberWarnings;

      console.error("WARNING REMOVAL ERROR:", error);

      await interaction.reply({
        content: "❌ تعذر حفظ التغييرات. حاول مرة ثانية.",
        ephemeral: true
      });

      return true;
    }

    await interaction.reply({
      content:
        `✅ تمت إزالة جميع تحذيرات <@${target.id}>\n` +
        `عدد التحذيرات المحذوفة: **${removed}**.`,
      ephemeral: true,
      allowedMentions: { users: [] }
    });

    return true;
  }

  if (
    interaction.isButton() &&
    (
      interaction.customId.startsWith("warnr_all_confirm_") ||
      interaction.customId.startsWith("warnr_all_cancel_")
    )
  ) {
    const isConfirm = interaction.customId.startsWith(
      "warnr_all_confirm_"
    );

    const expectedUserId = interaction.customId.replace(
      isConfirm ? "warnr_all_confirm_" : "warnr_all_cancel_",
      ""
    );

    if (interaction.user.id !== expectedUserId) {
      await interaction.reply({
        content: "❌ هذا التأكيد مخصص للمشرف الذي طلبه.",
        ephemeral: true
      });
      return true;
    }

    if (!canModerate(interaction)) {
      await interaction.reply({
        content: "❌ ما عندك صلاحية تنفيذ هذا الإجراء.",
        ephemeral: true
      });
      return true;
    }

    if (!isConfirm) {
      await interaction.update({
        content: "✅ تم إلغاء عملية مسح التحذيرات.",
        components: []
      });
      return true;
    }

    const guildId = interaction.guild.id;
    const previousWarnings = warnings[guildId] || {};
    const removed = Object.values(previousWarnings).reduce(
      (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
      0
    );

    warnings[guildId] = {};

    try {
      saveWarnings();
    } catch (error) {
      warnings[guildId] = previousWarnings;

      console.error("CLEAR ALL WARNINGS ERROR:", error);

      await interaction.update({
        content: "❌ تعذر حفظ التغييرات، لم يكتمل المسح.",
        components: []
      });
      return true;
    }

    await interaction.update({
      content:
        `✅ تم مسح تحذيرات جميع أعضاء السيرفر.\n` +
        `عدد التحذيرات المحذوفة: **${removed}**.`,
      components: []
    });

    return true;
  }

  return false;
}

module.exports = {
  commands,
  handleInteraction
};

