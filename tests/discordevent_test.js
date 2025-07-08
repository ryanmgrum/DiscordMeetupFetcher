const { Client, GatewayIntentBits, PrivacyLevel } = require('discord.js');
const config = require("../config.json");
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildScheduledEvents
  ]
});

client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);

  try {
    const guild = await client.guilds.fetch('844351295808602153');
    
    // Verify guild exists and bot has access
    if (!guild) throw new Error('Guild not found');
    await guild.fetch(); // Refresh guild data

    const event = await guild.scheduledEvents.create({
      name: 'Mitsuwa Meetup',
      scheduledStartTime: new Date('2024-12-01T19:00:00'), // Future date
      scheduledEndTime: new Date('2024-12-01T21:00:00'),
      privacyLevel: 2, // Use enum instead of number
      entityType: 'EXTERNAL',
      entityMetadata: {
        location: 'https://meetup.com/...' // Shorten URL if needed
      },
      description: 'Testing',
      reason: 'Community event creation' // Audit log reason
    });

    console.log(`Created event: ${event.name} (ID: ${event.id})`);
  } catch (error) {
    console.error('Creation failed:', error.stack); // Full error stack
  }
});

client.login(config.BOT_TOKEN);



















