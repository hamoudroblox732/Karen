const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const OWNER_ID = process.env.OWNER_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing TOKEN, CLIENT_ID or GUILD_ID");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User
  ]
});

const warnings = new Map();
const tickets = new Map();

function isOwner(member) {
  return member.id === OWNER_ID || member.permissions.has(PermissionFlagsBits.Administrator);
}

function isStaff(member) {
  return (
    isOwner(member) ||
    (STAFF_ROLE_ID && member.roles.cache.has(STAFF_ROLE_ID))
  );
}

function getWarnings(userId) {
  return warnings.get(userId) || [];
}

function addWarning(userId, warning) {
  const list = getWarnings(userId);
  list.push(warning);
  warnings.set(userId, list);
  return list.length;
}

function removeWarnings(userId) {
  warnings.delete(userId);
}

function formatDate(date) {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

async function sendDM(user, embed) {
  try {
    await user.send({ embeds: [embed] });
  } catch {
    return false;
  }
  return true;
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("ticket")
      .setDescription("إرسال لوحة فتح التذاكر"),

    new SlashCommandBuilder()
      .setName("lock")
      .setDescription("قفل الروم ومنع الأعضاء من الكتابة"),

    new SlashCommandBuilder()
      .setName("unlock")
      .setDescription("فتح الروم والسماح للأعضاء بالكتابة"),

    new SlashCommandBuilder()
      .setName("warn")
      .setDescription("إعطاء تحذير لعضو")
      .addUserOption(option =>
        option
          .setName("member")
          .setDescription("العضو")
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName("reason")
          .setDescription("سبب التحذير")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("unwarn")
      .setDescription("إزالة تحذيرات عضو أو جميع التحذيرات")
      .addStringOption(option =>
        option
          .setName("target")
          .setDescription("ID العضو أو all")
          .setRequired(true)
      )
  ].map(command => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("Slash commands registered.");
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Command registration error:", error);
  }

  client.user.setActivity("Support Tickets", {
    type: 3
  });
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleModal(interaction);
      return;
    }
  } catch (error) {
    console.error(error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "صار خطأ غير متوقع.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

async function handleCommand(interaction) {
  const command = interaction.commandName;

  if (command === "ticket") {
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: "هذا الأمر للإدارة فقط.",
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0xE53935)
      .setTitle("فتح تكت")
      .setDescription(
        "فتح التكت لو كان في مشكله بين شخصين او مشكله بالسكربت او استفسار اما فتحها للسوالف او طقطقه رح يتم تبنيدك"
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("open_ticket")
        .setLabel("اضغط لفتح تذكرة")
        .setEmoji("📩")
        .setStyle(ButtonStyle.Success)
    );

    await interaction.channel.send({
      embeds: [embed],
      components: [row]
    });

    return interaction.reply({
      content: "تم إرسال لوحة فتح التذاكر.",
      ephemeral: true
    });
  }

  if (command === "lock") {
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: "ما عندك صلاحية.",
        ephemeral: true
      });
    }

    await interaction.channel.permissionOverwrites.edit(
      interaction.guild.roles.everyone,
      {
        SendMessages: false
      }
    );

    return interaction.reply("🔒 تم قفل الروم.");
  }

  if (command === "unlock") {
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: "ما عندك صلاحية.",
        ephemeral: true
      });
    }

    await interaction.channel.permissionOverwrites.edit(
      interaction.guild.roles.everyone,
      {
        SendMessages: null
      }
    );

    return interaction.reply("🔓 تم فتح الروم.");
  }

  if (command === "warn") {
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: "ما عندك صلاحية.",
        ephemeral: true
      });
    }

    const member = interaction.options.getMember("member");
    const reason = interaction.options.getString("reason");

    if (!member) {
      return interaction.reply({
        content: "ما قدرت ألقى العضو.",
        ephemeral: true
      });
    }

    if (member.user.bot) {
      return interaction.reply({
        content: "ما تقدر تحذر بوت.",
        ephemeral: true
      });
    }

    const count = addWarning(member.id, {
      reason,
      moderatorId: interaction.user.id,
      date: new Date()
    });

    const embed = new EmbedBuilder()
      .setColor(0xFF9800)
      .setTitle("تحذير")
      .setDescription(
        `تم تحذير ${member}.\n\n**السبب:** ${reason}\n**عدد التحذيرات:** ${count}`
      )
      .setFooter({
        text: `بواسطة ${interaction.user.username}`
      });

    await interaction.reply({
      embeds: [embed]
    });

    const dmEmbed = new EmbedBuilder()
      .setColor(0xFF9800)
      .setTitle("تم تحذيرك")
      .addFields(
        {
          name: "السبب",
          value: reason
        },
        {
          name: "عدد التحذيرات",
          value: String(count)
        },
        {
          name: "المشرف",
          value: interaction.user.tag
        }
      );

    await sendDM(member.user, dmEmbed);
    return;
  }

  if (command === "unwarn") {
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: "ما عندك صلاحية.",
        ephemeral: true
      });
    }

    const target = interaction.options.getString("target").trim();

    if (target.toLowerCase() === "all") {
      warnings.clear();

      return interaction.reply({
        content: "تمت إزالة جميع التحذيرات من جميع الأعضاء."
      });
    }

    const member =
      interaction.guild.members.cache.get(target) ||
      interaction.guild.members.cache.find(
        m => m.id === target
      );

    if (!member) {
      return interaction.reply({
        content: "حط ID العضو أو استخدم `all`.",
        ephemeral: true
      });
    }

    const oldCount = getWarnings(member.id).length;

    removeWarnings(member.id);

    return interaction.reply(
      `تمت إزالة جميع تحذيرات ${member}. كان عنده ${oldCount} تحذير.`
    );
  }
}

async function handleButton(interaction) {
  if (interaction.customId === "open_ticket") {
    await interaction.deferReply({ ephemeral: true });

    const existing = interaction.guild.channels.cache.find(
      channel =>
        channel.type === ChannelType.GuildText &&
        channel.topic === `ticket-owner:${interaction.user.id}`
    );

    if (existing) {
      return interaction.editReply({
        content: `عندك تكت مفتوح بالفعل: ${existing}`
      });
    }

    const permissionOverwrites = [
      {
        id: interaction.guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks
        ]
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages
        ]
      }
    ];

    if (STAFF_ROLE_ID) {
      permissionOverwrites.push({
        id: STAFF_ROLE_ID,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles
        ]
      });
    }

    const channel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username}`
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, "")
        .slice(0, 20) || `ticket-${interaction.user.id}`,
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID || null,
      topic: `ticket-owner:${interaction.user.id}`,
      permissionOverwrites
    });

    tickets.set(channel.id, {
      channelId: channel.id,
      ownerId: interaction.user.id,
      claimedBy: null,
      createdAt: new Date(),
      claimedAt: null
    });

    const embed = new EmbedBuilder()
      .setColor(0xE53935)
      .setTitle("تم فتح التذكرة")
      .setDescription(
        "تم فتح التذكرة انتظر حتى قبولها قبل المشرفين"
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_close")
        .setLabel("إغلاق")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("ticket_claim")
        .setLabel("استلام")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("ticket_close_no_reason")
        .setLabel("إغلاق بدون سبب")
        .setStyle(ButtonStyle.Secondary)
    );

    await channel.send({
      content: `${interaction.user}`,
      embeds: [embed],
      components: [row]
    });

    await interaction.editReply({
      content: `تم فتح تذكرتك: ${channel}`
    });

    return;
  }

  if (
    interaction.customId === "ticket_claim"
  ) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: "ما عندك صلاحية استلام التذاكر.",
        ephemeral: true
      });
    }

    const ticket = tickets.get(interaction.channel.id);

    if (!ticket) {
      return interaction.reply({
        content: "هذا الروم مو تكت مسجل.",
        ephemeral: true
      });
    }

    if (ticket.claimedBy) {
      return interaction.reply({
        content: "التذكرة مستلمة بالفعل.",
        ephemeral: true
      });
    }

    ticket.claimedBy = interaction.user.id;
    ticket.claimedAt = new Date();

    tickets.set(interaction.channel.id, ticket);

    await interaction.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x43A047)
          .setDescription(
            `تم استلام التذكرة بواسطة ${interaction.user}.`
          )
      ]
    });

    return interaction.reply({
      content: "تم استلام التذكرة.",
      ephemeral: true
    });
  }

  if (interaction.customId === "ticket_close") {
    if (!isStaff(interaction.member) && interaction.user.id !== tickets.get(interaction.channel.id)?.ownerId) {
      return interaction.reply({
        content: "ما تقدر تقفل هذي التذكرة.",
        ephemeral: true
      });
    }

    const modal = new ModalBuilder()
      .setCustomId("ticket_close_modal")
      .setTitle("إغلاق التذكرة");

    const reasonInput = new TextInputBuilder()
      .setCustomId("close_reason")
      .setLabel("سبب الإغلاق")
      .setPlaceholder("اكتب سبب الإغلاق أو اتركه فارغاً")
      .setRequired(false)
      .setStyle(TextInputStyle.Paragraph);

    modal.addComponents(
      new ActionRowBuilder().addComponents(reasonInput)
    );

    return interaction.showModal(modal);
  }

  if (interaction.customId === "ticket_close_no_reason") {
    if (!isStaff(interaction.member) && interaction.user.id !== tickets.get(interaction.channel.id)?.ownerId) {
      return interaction.reply({
        content: "ما تقدر تقفل هذي التذكرة.",
        ephemeral: true
      });
    }

    await closeTicket(interaction.channel, interaction.user, "");
  }
}

async function handleModal(interaction) {
  if (interaction.customId !== "ticket_close_modal") {
    return;
  }

  const reason =
    interaction.fields.getTextInputValue("close_reason")?.trim() || "";

  await interaction.reply({
    content: "جاري إغلاق التذكرة...",
    ephemeral: true
  });

  await closeTicket(interaction.channel, interaction.user, reason);
}

async function closeTicket(channel, closedBy, reason) {
  const ticket = tickets.get(channel.id);

  if (!ticket) {
    return;
  }

  const guild = channel.guild;

  const owner = await guild.members
    .fetch(ticket.ownerId)
    .catch(() => null);

  const claimer = ticket.claimedBy
    ? await guild.members.fetch(ticket.claimedBy).catch(() => null)
    : null;

  const closedAt = new Date();

  const details = new EmbedBuilder()
    .setColor(0xE53935)
    .setTitle("تفاصيل التذكرة المغلقة")
    .addFields(
      {
        name: "فتح التذكرة",
        value: owner ? `${owner.user.tag} (${owner.id})` : ticket.ownerId
      },
      {
        name: "وقت الفتح",
        value: formatDate(ticket.createdAt)
      },
      {
        name: "المستلم",
        value: claimer
          ? `${claimer.user.tag} (${claimer.id})`
          : "لم يتم استلامها"
      },
      {
        name: "وقت الاستلام",
        value: ticket.claimedAt
          ? formatDate(ticket.claimedAt)
          : "لم يتم الاستلام"
      },
      {
        name: "أغلقها",
        value: `${closedBy.tag} (${closedBy.id})`
      },
      {
        name: "وقت الإغلاق",
        value: formatDate(closedAt)
      },
      {
        name: "سبب الإغلاق",
        value: reason || "لم يتم تحديد سبب"
      }
    );

  if (owner) {
    await sendDM(owner.user, details);
  }

  if (claimer && claimer.id !== owner?.id) {
    await sendDM(claimer.user, details);
  }

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xE53935)
        .setTitle("تم إغلاق التذكرة")
        .setDescription("سيتم حذف الروم خلال 5 ثواني.")
    ]
  }).catch(() => {});

  tickets.delete(channel.id);

  setTimeout(async () => {
    await channel.delete("Ticket closed").catch(() => {});
  }, 5000);
}

client.on("messageCreate", async message => {
  if (message.author.bot) return;

  if (
    message.channel.type !== ChannelType.GuildText ||
    !message.channel.topic?.startsWith("ticket-owner:")
  ) {
    return;
  }

  if (!OPENAI_API_KEY) {
    return;
  }

  await message.channel.sendTyping().catch(() => {});

  try {
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-6-luna",
          instructions:
            "أنت مساعد دعم داخل تذكرة Discord. رد بالعربية الخليجية بشكل طبيعي ومختصر. ساعد المستخدم في مشاكل السكربتات والاستفسارات والمشاكل بين الأعضاء. لا تدعي أنك مشرف. إذا كانت المشكلة تحتاج تدخل بشري قل له بوضوح أن المشرف سيتدخل. لا تعطِ معلومات خطيرة أو غير مناسبة.",
          input: [
            {
              role: "user",
              content: message.content || "المستخدم أرسل مرفقاً بدون نص."
            }
          ],
          max_output_tokens: 700
        })
      }
    );

    if (!response.ok) {
      console.error("OpenAI API error:", await response.text());
      return;
    }

    const data = await response.json();
    const answer = data.output_text || "ما قدرت أطلع رد حالياً.";

    await message.channel.send(answer.slice(0, 1900));
  } catch (error) {
    console.error("AI error:", error);
  }
});

client.login(TOKEN);
