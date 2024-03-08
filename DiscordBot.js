'use strict';
const {Client, GatewayIntentBits} = require("discord.js"); // Used for interfacing with Discord
const client = new Client({
    intents: [
        GatewayIntentBits.MessageContent
    ]
}); // Used for interacting with Discord
const config = require("./config.json"); // config file containing necessary information to function
const bent = require('bent'); // Used for fetching RSS-formatted feeds
const moment = require('moment-timezone'); // Used to easily format Date objects.

module.exports = class DiscordBot {

    constructor() {
        this.numOfEvents = 100;
    }

    /** deleteOldEvents searches the config-specified channel ID's message history for bot
     *  messages of events that have already happened and deletes them.
     *  It will search the message contents for the event date (using the same regex pattern used
     *  in fetchMeetupEvents) and compare that with now to determine whether to delete the message.
     * @param err Whether an Error occurred before calling this function.
     */
     deleteOldEvents(err) {
        if (err !== null) {
            console.error(err);
            return;
        }

        // First find the events to delete.
        client.channels.fetch(config.CHANNEL_ID).then(
            channel => {
                channel.messages.fetch({limit: this.numOfEvents}).then(
                messages => {
                    // Iterate through the messages here with the variable "messages".
                    let yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    messages.forEach(message => {
                        if (message.member.user.id == '845419198917902376' /*Discord Bot's ID*/)
                            if (new Date(message.createdTimestamp) - yesterday < 0)
                                message.delete(); // Delete old event message.
                    })
                })
            }
        )
    }

    /** fetchMeetupEvents reads the RSS feed for the given Meetup group URL in config.json
     *  and adds it to an array that will be passed to addDiscordEvents. The array will only
     *  contain events that are not yet in the specified guildID's channelName (assuming this only runs once a day).
     * @param err Whether an Error occurred before calling this function.
     */
    async fetchMeetupEvents(err) {
        if (err !== null) {
            console.error(err);
            return;
        }

        let tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        let meetupEvents = [];

        let bentJSON = bent('json');
        let json = await bentJSON(config.MEETUP_RSS_FEED);

        json.responses[0].value.forEach(event => {
            let eventTime = new Date(event.time);
            //console.log("Event Name " + event.name + " at " + eventTime + ".");
            if (eventTime.toDateString() == tomorrow.toDateString()) {
                //console.log("Posting event to Discord!");
                meetupEvents.push(event);
            }
        });

        if (meetupEvents.length == 0)
            console.log(tomorrow + ": Nothing new at this time.");
        else
            this.addDiscordEvents(err, meetupEvents);
    }

    /** addDiscordEvents writes messages from the passed-in eventList array of new events read
     *  from the given Meetup group RSS feed in config.json.
     * @param err Whether an Error occurred before processing this function.
     * @param eventList An Array containing a list of new events read from the Meetup RSS feed
     * (read from config.json).
     */
    addDiscordEvents(err, eventList) {
        if (err !== null) {
            console.error(err);
            return;
        }

        let channel = client.channels.cache.get(config.CHANNEL_ID);

        eventList.forEach(event => {
            /** Output the event in the following format:
             * Event Name
             *
             * When: EVENT_START_DATETIME
             * Where: NAME, ADDRESS_1, CITY, STATE, ZIP, LOCALIZED_COUNTRY_NAME (or Online if is_online_event is true)
             * RSVP Slots Available: RSVP_LIMIT
             * Hosts: HOST_NAMES
             * Description: PLAIN_TEXT_NO_IMAGES_DESCRIPTION
             * Event Link: LINK
             */
            let output = "**" + event.name + "**\n\n";
            output += "*When*: " + moment(new Date(event.time)).tz("America/Chicago").format("ddd MMM Do YYYY hh:mm:ss A zz") + "\n";

            if (event.is_online_event == false) {
                let addressPieces = []
                if (event.venue.name != "")
                    addressPieces.push(event.venue.name);
                if (event.venue.address_1 != "")
                    addressPieces.push(event.venue.address_1);
                if (event.venue.city != "")
                    addressPieces.push(event.venue.city);
                if (event.venue.state != "")
                    addressPieces.push(event.venue.state);
                if (event.venue.zip != "")
                    addressPieces.push(event.venue.zip);
                if (event.venue.localized_country_name != "")
                    addressPieces.push(event.venue.localized_country_name);

                output += "*Where*: " + addressPieces.join(", ") + "\n";
            } else {
                output += "*Where*: Online\n";
            }

            output += "*RSVP Slots Available*: " + event.rsvp_limit + "\n";

            let hosts = []
            event.event_hosts.forEach(host => {
                hosts.push(host.name);
            });
            output += "*Host(s)*: " + hosts.join(", ") + "\n";

            output += "*Description*: \"" + event.plain_text_no_images_description + "\"\n"

            output += "*Event Link*: " + event.link + "\n\n"

            //console.log(output);

            channel.send(output);
        });
    }

    /** run is used to start the DiscordBot.
     */
    run() {
        // Log client into MeetupEventFetcher Discord bot.
        client.login(config.BOT_TOKEN).then(
            client.once('ready', () => {
                this.deleteOldEvents(null);
                this.fetchMeetupEvents(null);
            })
        );

        //console.time("Discord bot runtime.");
        
        setTimeout(() => {
            //console.timeEnd("Discord bot runtime.");
            this.end();
        }, 10000);
    }

    /** end is used to stop the DiscordBot.
     */
    end() {
        client.destroy();
    }
}