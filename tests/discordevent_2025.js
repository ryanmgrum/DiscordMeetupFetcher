const axios = require('axios');
const cheerio = require('cheerio');

async function getBuildId(htmlUrl) {
  
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
async function fetchUpcomingEvents() {
  try {
    const buildId = await getBuildId('https://www.meetup.com/introverts_hangout/events/calendar/');
    const url = 'https://www.meetup.com/_next/data/'+buildId+'/en-US/introverts_hangout/events/calendar.json';
    console.log(url)
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      }
    });
    const events = data?.pageProps.__APOLLO_STATE__
    let tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    for (let key in events) {
      if(events[key].__typename == 'Event')
        if (new Date(events[key].dateTime).toDateString() == tomorrow.toDateString()) {
          //console.log(key, events[key]);
          console.log(events[key].id)
          console.log(events[key].title)
          console.log(events[key].eventUrl)
          console.log(events[key].description)
          console.log(events[key].dateTime)
        }
    }
   
  } catch (err) {
    console.error('Failed to fetch events:', err.message);
  }
}

fetchUpcomingEvents();