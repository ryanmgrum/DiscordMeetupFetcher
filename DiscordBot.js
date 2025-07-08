// Updated Node.js code using dynamic build ID and latest dependencies
'use strict';

const { Client, GatewayIntentBits, TextChannel, Message } = require("discord.js");
const axios = require('axios');
const cheerio = require('cheerio');
const moment = require('moment-timezone');
const config = require("./config.json");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents
    ]
});

/**
 * @typedef {Object} MeetupEvent
 * @property {string} id
 * @property {string} title
 * @property {string} eventUrl
 * @property {string} description
 * @property {string} dateTime
 * @property {boolean} [online]
 * @property {Object} [venue]
 * @property {string} [venue.__ref]
 * @property {string} [venue.dateTime]
 * @property {string} [venue.city]
 * @property {string} [venue.state]
 * @property {string} [venue.zip]
 * @property {string} [venue.localized_country_name]
 * @property {boolean} [is_online_event]
 * @property {number} [rsvp_limit]
 * @property {Array<{name: string}>} [event_hosts]
 * @property {string} [name]
 * @property {string} [link]
 */

module.exports = class DiscordBot {
    /**
     * @type {number}
     */
    numOfEvents;

    constructor() {
        this.numOfEvents = config.NUM_OF_EVENTS || 100;
    }

    /**
     * Fetches the build ID from the Meetup HTML page, required to construct the data URL.
     * @param {string} htmlUrl - URL of the Meetup group's calendar page.
     * @returns {Promise<string>} - The build ID extracted from the page.
     */
    async getBuildId(htmlUrl) {
        try {
            const { data: html } = await axios.get(htmlUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
            });

            const $ = cheerio.load(html);
            const scriptTag = $('script#__NEXT_DATA__').html();
            const jsonData = JSON.parse(scriptTag);

            return jsonData.buildId;
        } catch (err) {
            console.error('Failed to fetch build ID:', err.message);
            throw err;
        }
    }

    /**
     * Retrieves upcoming events JSON from the Meetup group data endpoint.
     * @returns {Promise<Object|null>} - Raw JSON data from the events endpoint.
     */
    async fetchUpcomingEvents() {
        try {
            const buildId = await this.getBuildId('https://www.meetup.com/introverts_hangout/events/calendar/');
            const url = `https://www.meetup.com/_next/data/${buildId}/en-US/introverts_hangout/events/calendar.json`;

            const { data } = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                }
            });

            return data;
        } catch (err) {
            console.error('Failed to fetch events:', err.message);
            return null;
        }
    }

    /**
     * Deletes old event messages previously posted by the bot if they are older than yesterday.
     * @param {Error|null} err - Optional error passed from previous operations.
     * @returns {void}
     */
    deleteOldEvents(err) {
        if (err) {
            console.error(err);
            return;
        }

        client.channels.fetch(config.CHANNEL_ID).then(channel => {
            /** @type {TextChannel} */
            const textChannel = channel;
            textChannel.messages.fetch({ limit: 100 })
                .then(messages => {
                    let yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);

                    messages.forEach(/** @param {Message} message */ message => {
                        if (message.author.id === config.BOT_ID) {
                            if (new Date(message.createdTimestamp) < yesterday) {
                                message.delete();
                            }
                        }
                    });
                });
        });
    }

    /**
     * Filters and collects a limited number of Meetup events scheduled for tomorrow.
     * Gathers venues and events into hash tables, and attaches full venue data to each event.
     * Sends these events to the Discord channel if found.
     * @param {Error|null} err - Optional error passed from previous operations.
     * @returns {Promise<void>}
     */
    async fetchMeetupEvents(err) {
        if (err) {
            console.error(err);
            return;
        }

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        try {
            const data = await this.fetchUpcomingEvents();
            if (!data) return;

            const apolloState = data?.pageProps?.__APOLLO_STATE__;
            /** @type {Object.<string, string>} */
            const venuesById = {};
            /** @type {Object.<string, string>} */
            const eventsById = {};
            /** @type {Object.<string, string>} */
            const membersById = {};
            /** @type {MeetupEvent[]} */
            const filtered = [];

            // Gather venues, events, and members into hash tables
            for (let key in apolloState) {
                const obj = apolloState[key];
                if (obj.__typename === 'Venue' && obj.id) {
                    venuesById[obj.id] = JSON.stringify(obj);
                } else if (obj.__typename === 'Event' && obj.id) {
                    eventsById[obj.id] = JSON.stringify(obj);
                } else if (obj.__typename === 'Member' && obj.id) {
                    membersById[obj.id] = JSON.stringify(obj);
                }
            }

            // Filter for tomorrow's events and attach full venue JSON
            for (let key in apolloState) {
                const event = apolloState[key];
                if (event.__typename === 'Event') {
                    const eventDate = new Date(event.dateTime);
                    if (eventDate.toDateString() === tomorrow.toDateString()) {
                        // Attach full venue JSON if available
                        if (event.venue && event.venue.id && venuesById[event.venue.id]) {
                            event.venue = JSON.parse(venuesById[event.venue.id]);
                        }
                        // Attach membersById for use in addDiscordEvents
                        event._membersById = membersById;
                        filtered.push(event);
                        if (filtered.length >= this.numOfEvents) break;
                    }
                }
            }

            if (filtered.length === 0) {
                console.log(tomorrow + ": Nothing new at this time.");
            } else {
                this.addDiscordEvents(null, filtered);
            }

        } catch (err) {
            console.error('Error fetching events:', err.message);
        }
    }

    /**
     * Posts the list of provided Meetup events to the configured Discord channel.
     * @param {Error|null} err - Optional error passed from previous operations.
     * @param {MeetupEvent[]} eventList - List of event objects to be posted to Discord.
     * @returns {void}
     */
    addDiscordEvents(err, eventList) {
        if (err) {
            console.error(err);
            return;
        }

        const channel = client.channels.cache.get(config.CHANNEL_ID);

        eventList.forEach(event => {
            let output = `**${event.name}**\n\n`;
            output += `*When*: ${moment(new Date(event.dateTime)).tz("America/Chicago").format("ddd MMM Do YYYY hh:mm:ss A zz")}\n`;

            if (!event.is_online_event) {
                let addressPieces = [];
                if (event.venue?.name) addressPieces.push(event.venue.name);
                if (event.venue?.address) addressPieces.push(event.venue.address);
                if (event.venue?.city) addressPieces.push(event.venue.city);
                if (event.venue?.state) addressPieces.push(event.venue.state);
                if (event.venue?.country) addressPieces.push(event.venue.country);

                output += `*Where*: ${addressPieces.join(", ")}\n`;
            } else {
                output += `*Where*: Online\n`;
            }

            // RSVP slots removed as rsvp_limit is no longer available
            // output += `*RSVP Slots Available*: ${event.rsvp_limit ?? 'N/A'}\n`;

            // Use eventHosts and membersById for host names
            let hostNames = [];
            if (Array.isArray(event.eventHosts) && event._membersById) {
                for (const host of event.eventHosts) {
                    if (host.memberId && event._membersById[host.memberId]) {
                        const member = JSON.parse(event._membersById[host.memberId]);
                        if (member.name) hostNames.push(member.name);
                    }
                }
            }
            output += `*Host(s)*: ${hostNames.join(", ")}\n`;

            output += `*Description*: "${event.description ?? 'No description.'}"\n`;

            output += `*Event Link*: ${event.link || event.eventUrl}\n`;

            channel.send(output);
        });
    }

    /**
     * Starts the Discord bot, logging in and triggering event deletion and event posting.
     * @returns {void}
     */
    run() {
        client.login(config.BOT_TOKEN).then(() => {
            client.once('ready', () => {
                this.deleteOldEvents(null);
                this.fetchMeetupEvents(null);
            });
        });

        setTimeout(() => this.end(), 10000);
    }

    /**
     * Stops the Discord bot by destroying the client connection.
     * @returns {void}
     */
    end() {
        client.destroy();
    }
};
