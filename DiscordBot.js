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
 * @property {boolean} [isOnline]
 * @property {{ __ref: string }} [venue]
 * @property {Array<{ memberId: string }>} [eventHosts]
 */

module.exports = class DiscordBot {
    /**
     * @type {number}
     */
    numOfEvents;

    constructor() {
        this.numOfEvents = config.NUM_OF_EVENTS || 100;
    }

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

    deleteOldEvents(err, force = false) {
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
                            if (force || new Date(message.createdTimestamp) < yesterday) {
                                message.delete();
                            }
                        }
                    });
                });
        });
    }

    async fetchMeetupEvents(err) {
        if (err) {
            console.error(err);
            return;
        }
        const today = new Date();
        try {
            const data = await this.fetchUpcomingEvents();
            if (!data) return;
            const apolloState = data?.pageProps?.__APOLLO_STATE__;
            /** @type {Object.<string, string>} */
            const venuesById = {};
            /** @type {Object.<string, string>} */
            const membersById = {};
            /** @type {MeetupEvent[]} */
            const filtered = [];
            // Gather venues and members into hash tables
            for (let key in apolloState) {
                const obj = apolloState[key];
                if (obj.__typename === 'Venue' && obj.id) {
                    venuesById[obj.id] = JSON.stringify(obj);
                } else if (obj.__typename === 'Member' && obj.id) {
                    membersById[obj.id] = JSON.stringify(obj);
                }
            }
            // Filter for today's events
            for (let key in apolloState) {
                const event = apolloState[key];
                if (event.__typename === 'Event') {
                    const eventDate = new Date(event.dateTime);
                    if (eventDate.toDateString() === today.toDateString()) {
                        filtered.push(event);
                        if (filtered.length >= this.numOfEvents) break;
                    }
                }
            }
            if (filtered.length === 0) {
                console.log(today + ": Nothing new at this time.");
            } else {
                this.addDiscordEvents(null, filtered, venuesById, membersById);
            }
        } catch (err) {
            console.error('Error fetching events:', err.message);
        }
    }

    addDiscordEvents(err, eventList, venuesById = {}, membersById = {}) {
        if (err) {
            console.error(err);
            return;
        }
        const channel = client.channels.cache.get(config.CHANNEL_ID);
        eventList.forEach(event => {
            let output = `**${event.title}**\n\n`;
            output += `*When*: ${moment(new Date(event.dateTime)).tz("America/Chicago").format("ddd MMM Do YYYY hh:mm:ss A zz")}\n`;
            // Venue lookup using __ref (e.g., "Venue:12345")
            let addressPieces = [];
            let venue = null;
            if (event.venue && typeof event.venue.__ref === 'string') {
                const refMatch = event.venue.__ref.match(/^Venue:(.+)$/);
                if (refMatch && venuesById[refMatch[1]]) {
                    venue = JSON.parse(venuesById[refMatch[1]]);
                }
            }
            if (!event.isOnline) {
                if (venue) {
                    if (venue.name) addressPieces.push(venue.name);
                    if (venue.address) addressPieces.push(venue.address);
                    if (venue.city) addressPieces.push(venue.city);
                    if (venue.state) addressPieces.push(venue.state);
                    if (venue.country) addressPieces.push(venue.country);
                }
                output += `*Where*: ${addressPieces.length > 0 ? addressPieces.join(", ") : 'Unknown'}\n`;
            } else {
                output += `*Where*: Online\n`;
            }
            // Use eventHosts and membersById for host names
            let hostNames = [];
            if (Array.isArray(event.eventHosts)) {
                for (const host of event.eventHosts) {
                    if (host.memberId && membersById[host.memberId]) {
                        const member = JSON.parse(membersById[host.memberId]);
                        if (member.name) hostNames.push(member.name);
                    }
                }
            }
            output += `*Host${hostNames.length !== 1 ? 's' : ''}*: ${hostNames.join(", ")}\n`;
            // Add event description
            output += `*Description*: ${event.description ? event.description : 'No description.'}\n`;
            // Add event link
            output += `*Event Link*: ${event.eventUrl ? event.eventUrl : 'No link.'}\n`;
            channel.send(output);
        });
    }

    run(forceDeleteEvents = false) {
        client.login(config.BOT_TOKEN).then(() => {
            client.once('ready', () => {
                this.deleteOldEvents(null, forceDeleteEvents);
                this.fetchMeetupEvents(null);
            });
        });
        setTimeout(() => this.end(), 10000);
    }

    end() {
        client.destroy();
    }
};