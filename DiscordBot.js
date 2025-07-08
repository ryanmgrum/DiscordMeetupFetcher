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
 * DiscordBot class for fetching, filtering, and posting Meetup events to Discord.
 */
module.exports = class DiscordBot {
    /**
     * Number of events to fetch and process.
     * @type {number}
     */
    numOfEvents;

    /**
     * Constructs a new DiscordBot instance.
     */
    constructor() {
        this.numOfEvents = config.NUM_OF_EVENTS || 100;
    }

    /**
     * Fetches the build ID from the Meetup HTML page, required to construct the data URL.
     * @param {string} htmlUrl - URL of the Meetup group's calendar page.
     * @returns {Promise<string>} - The build ID extracted from the page.
     * @throws {Error} - If the build ID cannot be fetched or parsed.
     */
    async getBuildId(htmlUrl /** @type {string} */) /** @returns {Promise<string>} */ {
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
     * @returns {Promise<Object|null>} - Raw JSON data from the events endpoint, or null on error.
     */
    async fetchUpcomingEvents() /** @returns {Promise<Object|null>} */ {
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
     * Deletes old event messages previously posted by the bot if they are older than now.
     * @param {Error|null} err - Optional error passed from previous operations.
     * @returns {void}
     */
    deleteOldEvents(err /** @type {Error|null} */) /** @returns {void} */ {
        if (err) {
            console.error(err);
            return;
        }
        client.channels.fetch(config.CHANNEL_ID).then((channel /** @type {TextChannel} */) => {
            const textChannel = channel;
            textChannel.messages.fetch({ limit: 100 })
                .then(messages => {
                    let now = new Date();
                    messages.forEach((message /** @type {Message} */) => {
                        if (message.author.id === config.BOT_ID) {
                            if (new Date(message.createdTimestamp) < now) {
                                message.delete();
                            }
                        }
                    });
                });
        });
    }

    /**
     * Filters and collects a limited number of Meetup events scheduled for today.
     * Gathers venues, events, and members into hash tables, and attaches full venue data to each event.
     * Sends these events to the Discord channel if found.
     * @param {Error|null} err - Optional error passed from previous operations.
     * @returns {Promise<void>}
     */
    async fetchMeetupEvents(err /** @type {Error|null} */) /** @returns {Promise<void>} */ {
        if (err) {
            console.error(err);
            return;
        }
        const today = new Date();
        try {
            const data = await this.fetchUpcomingEvents();
            if (!data) return;
            /** @type {Object.<string, string>} */
            const venuesById = {};
            /** @type {Object.<string, string>} */
            const eventsById = {};
            /** @type {Object.<string, string>} */
            const membersById = {};
            /** @type {Array<Object>} */
            const filtered = [];
            const apolloState = data?.pageProps?.__APOLLO_STATE__;
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
            // Filter for today's events and attach full venue JSON
            for (let key in apolloState) {
                const event = apolloState[key];
                if (event.__typename === 'Event') {
                    const eventDate = new Date(event.dateTime);
                    if (eventDate.toDateString() === today.toDateString()) {
                        if (event.venue && event.venue.id && venuesById[event.venue.id]) {
                            event.venue = JSON.parse(venuesById[event.venue.id]);
                        }
                        event._membersById = membersById;
                        filtered.push(event);
                        if (filtered.length >= this.numOfEvents) break;
                    }
                }
            }
            if (filtered.length === 0) {
                console.log(today + ": Nothing new at this time.");
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
     * @param {Array<Object>} eventList - List of event objects to be posted to Discord.
     * @returns {void}
     */
    addDiscordEvents(err /** @type {Error|null} */, eventList /** @type {Array<Object>} */) /** @returns {void} */ {
        if (err) {
            console.error(err);
            return;
        }
        const channel = client.channels.cache.get(config.CHANNEL_ID);
        eventList.forEach((event /** @type {any} */) => {
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
            output += `*Event Link*: ${event.eventUrl}\n`;
            channel.send(output);
        });
    }

    /**
     * Starts the Discord bot, logging in and triggering event deletion and event posting.
     * @returns {void}
     */
    run() /** @returns {void} */ {
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
    end() /** @returns {void} */ {
        client.destroy();
    }
}