'use strict';
const Discord = require("discord.js"); // Used for interfacing with Discord
const client = new Discord.Client(); // Used for interacting with Discord
const config = require("./config.json"); // config file containing necessary information to function
const Parser = require('rss-parser'); // Used for parsing RSS feeds
const cheerio = require('cheerio'); // Used for parsing HTML-like code

module.exports = class DiscordBot {

    constructor() {
        this.discordEventList = [];
        this.numOfEvents = 100;
    }

    /** deleteOldEvents searches the config-specified channel ID's message history for bot
     *  messages of events that have already happened and deletes them.
     *  It will search the message contents for the event date (using the same regex pattern used
     *  in fetchMeetupEvents) and compare that with now to determine whether to delete the message.
     * @param err Whether an Error occurred before calling this function.
     */
     deleteOldEvents(err) {
        // First find the events to delete.
        let deleteEvents = [];
        let channel = client.channels.cache.get(config.CHANNEL_ID);
        channel.messages.fetch({limit: this.numOfEvents}).then(messages => {
            // Iterate through the messages here with the variable "messages".
            let regPattern = /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (January|February|March|April|May|June|July|August|September|October|November|December) (\d+) at (\d+):(0\d|\d+) ([AP]M)/;
            let now = new Date();
            messages.forEach(message => {
                if (message.member.user.id == '845419198917902376' /*Discord Bot's ID*/) {
                    // Fetch date from message contents.
                    let datePieces = message.content.match(regPattern);
                    let date = new Date(`${datePieces[1]} ${datePieces[2]}, ${new Date().getFullYear()} ${datePieces[5] == 'PM' ? Number(datePieces[3]) + 12 : datePieces[3]}:${datePieces[4]}`);
                    if (date - now  < 0)
                        //console.log('Deleting ' + message.content);
                        message.delete(); // Delete old event message.
                }
            });
        });
    }

    /** fetchMeetupEvents reads the RSS feed for the given Meetup group URL in config.json
     *  and adds it to an array that will be passed to addDiscordEvents. The array will only
     *  contain events that are not yet in the specified guildID's channelName.
     * @param err Whether an Error occurred before calling this function.
     */
    fetchMeetupEvents(err) {
        if (err !== null) {
            console.log(err);
            return;
        }

        new Parser().parseURL(config.MEETUP_RSS_FEED).then(feed => {
            let meetupEvents = [];

            feed.items.forEach(item => {
                // Parse item's content to get the event's start date and time.
                let $ = cheerio.load(item.content);
                let regPattern = /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (January|February|March|April|May|June|July|August|September|October|November|December) (\d+) at (\d+):(0\d|\d+) ([AP]M)/;
                //console.log(item.content);
                $('p').each(function(i, el) {
                    if (el.firstChild !== null)
                        if (el.firstChild.data != undefined)
                            if (el.firstChild.data.match(regPattern) !== null) {
                                let datePieces = el.firstChild.data.match(regPattern);
                                let date = new Date(`${datePieces[1]} ${datePieces[2]}, ${new Date().getFullYear()} ${datePieces[5] == 'PM' ? (Number(datePieces[3]) === 12 ? 12 : Number(datePieces[3]) + 12) : datePieces[3]}:${datePieces[4]}`);
                                if (date.toDateString() == new Date().toDateString())
                                    meetupEvents.push(item);
                            }
                });
            });

            if (meetupEvents.length != 0) // Output new events.
                try {
                    this.addDiscordEvents(err, meetupEvents);
                } catch (error) {
                    console.log(err);
                    this.end();
                }
            else { // Print message notifying no new events with current date and time.
                let date_ob = new Date();
    
                // current date
                // adjust 0 before single digit date
                let day = ("0" + date_ob.getDate()).slice(-2);
    
                // current month
                let month = ("0" + (date_ob.getMonth() + 1)).slice(-2);
    
                // current year
                let year = date_ob.getFullYear();
    
                // current hours
                let hours = date_ob.getHours();
    
                // current minutes
                let minutes = date_ob.getMinutes();
    
                // current seconds
                let seconds = date_ob.getSeconds();
                console.log(year + '-' + month + '-' + day + ' ' + hours + ':' + minutes + ':' + seconds + ' Nothing new at this time.');
                this.end();
            }
        });
    }

    /** addDiscordEvents writes messages from the passed-in eventList array of new events read
     *  from the given Meetup group RSS feed in config.json.
     *  Precondition: The events do not exist in discordEventList.
     * @param err Whether an Error occurred before processing this function.
     * @param eventList An Array containing a list of new events read from the Meetup RSS feed
     * (read from config.json).
     */
    addDiscordEvents(err, eventList) {
        if (err !== null) {
            console.log(err);
            return;
        }

        let count = 0;
        eventList.forEach(e => {
            let processList = async (e) => {
                let output = e.title.trim() + '\n\n';

                let $ = cheerio.load(e.content);
                let regPattern = /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (January|February|March|April|May|June|July|August|September|October|November|December) (\d+) at (\d+):(0\d|\d+) ([AP]M)/;
                $('p').each(function(i, el) {
                    if (el.firstChild !== null && el.firstChild != undefined)
                        el.children.forEach((child) => {
                            if (child.data != undefined)
                                if (
                                    (child.type == 'text' &&
                                     child.data != e.guid &&
                                     child.data.match(/^\d+$/) === null &&
                                     child.data.match('Introverts Hangout') === null
                                    ) ||
                                    child.data.match(regPattern) !== null
                                )
                                    output += child.data + '\n';
                        });
                });

                output += '\n' + e.guid;

                let channel = client.channels.cache.get(config.CHANNEL_ID);
                if (channel != undefined) {
                    //console.log('Writing event "' + e.title.trim() + '"\n');
                    await channel.send(output);
                }

                count++;
                if (count == eventList.length)
                    this.end();
            }
            processList(e);
        });
    }

    /** run is used to start the DiscordBot.
     */
    run() {
        // Log client in to MeetupEventFetcher Discord bot.
        client.login(config.BOT_TOKEN).then(
            // Check for new Meetup events.
            client.once('ready', () => {
                this.deleteOldEvents(null);
                this.fetchMeetupEvents(null);
            })
        );
    }

    /** end is used to stop the DiscordBot.
     */
    end() {
        client.destroy();
    }
}