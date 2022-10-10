process.env.DEBUG = 'prismarine-auth'

import { DISCORD_TOKEN, DISCORD_CHANNEL_ID, SERVER_IP, EMAIL } from './config.json'
import mineflayer, { Bot } from 'mineflayer'
import { Client, Intents } from 'discord.js'
import { holdCrop, startFarming } from './farm'
import { getPotatoCount, requestStatistics } from './utils'

let [HOST, PORT] = SERVER_IP.split(':')
if (!PORT) PORT = '25565'


function makeBot() {
  return mineflayer.createBot({
    host: HOST,
    port: Number(PORT),
    username: EMAIL,
    version: '1.18.2',
    // if it's not an email, offline mode
    auth: EMAIL.includes('@') ? 'microsoft' : 'mojang',
    checkTimeoutInterval: 60 * 1000,
    viewDistance: 'short', // 8 chunks
    disableChatSigning: true
  })
}

let bot = makeBot()

const discord = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] })

discord.once('ready', () => {
  console.log('Discord bot ready')
})

discord.login(DISCORD_TOKEN)

let onServer = false

discord.on('messageCreate', m => {
  if (m.channel.id !== DISCORD_CHANNEL_ID || m.author.bot) return

  if (!onServer) {
    m.react('👎')
    return
  }

  const msg = `${m.author.username}#${m.author.discriminator}: ${m.cleanContent.replace(/​/g, '')}`.replace(/\n/g, ' ')
  if (msg.length > 256 || msg.startsWith('/') || /[\x00-\x1F\x7F\xA7]/.test(msg)) {
    m.react('🚫')
  } else {
    bot.chat(msg.replace(/\n/g, ' '))
    m.react('👍')
  }
})



async function getChannel() {
  const channel = discord.channels.cache.get(DISCORD_CHANNEL_ID) || (await discord.channels.fetch(DISCORD_CHANNEL_ID))
  if (!channel) {
    console.log('no channel')
    return
  }
  if (channel.type !== 'GUILD_TEXT') {
    console.log('channel is not text')
    return
  }
  return channel
}

const queuedMessages: string[] = []
async function sendInDiscord(message: string) {
  if (!discord) return
  queuedMessages.push(message)
  updateDiscordFromQueue()
}

let currentlySending = false
// don't have this function running several times at once (technically not necessary but patches memory leak)
let waitingToSend = false
async function updateDiscordFromQueue() {
  if (waitingToSend) {
    console.log('no need to make a new updateDiscordFromQueue')
    return
  }
  waitingToSend = true
  while (currentlySending || queuedMessages.length === 0) await new Promise(r => setTimeout(r, 100))
  waitingToSend = false
  currentlySending = true

  let message: string
  if (queuedMessages.length >= 3) {
    const sendingMessages = queuedMessages.splice(0, 15)
    message = sendingMessages.join('\n')
  } else {
    message = queuedMessages.shift()!
  }

  try {
    const channel = await getChannel()
    if (!channel) {
      console.warn('no channel!')
      currentlySending = false
      return
    }
    console.log('ok!! sending message in discord:', message)
    await channel.send({
      content: message,
      allowedMentions: {
        parse: [],
        users: [],
        roles: []
      }
    })
  } catch (e) {
    console.error(e)
  }
  currentlySending = false
  if (queuedMessages.length > 0) updateDiscordFromQueue()
}

function start() {
  let spawned = false

  bot.on('spawn', async () => {
    onServer = true
    if (!spawned)
      // wait for chunks to load and stuff
      setTimeout(async () => {
        while (true) {
          try {
            await startFarming(bot)
          } catch (e) {
            console.error(e)
            break
          }
        }
      }, 4000)


    spawned = true

    console.log('spawned')
    try {
      if (discord) {
        await updateDiscordStatus()
        await updateDiscordChannelDescription()
      } else {
        setTimeout(async () => {
          await updateDiscordStatus()
          await updateDiscordChannelDescription()
        }, 5000)
      }
    } catch { }

    console.log('spawned', bot.entity.position)
  })

  const USERNAME_REGEX = '(?:\\(.+\\)|\\[.+\\]|.)*?(\\w+)'
  const WHISPER_REGEX = new RegExp(`^${USERNAME_REGEX} whispers(?: to you)?:? (.*)$`)

  bot.on('messagestr', (m, position) => {
    if (position === 'game_info') return
    if (m === 'matdoesdev joined the game') return
    if (m.startsWith(`<${bot.username}> `)) return
    if (WHISPER_REGEX.test(m)) return
    console.log('message', m)
    sendInDiscord(m.replace(/_/g, '\\_'))
  })


  bot.on('chat', (username, message) => {
    console.log(username, message)
    if (username === bot.username) return
  })

  bot.on('health', async () => {
    if (bot.usingHeldItem || !spawned || !bot.canEat) return
    if ((bot.health < 20 && bot.food < 20) || bot.food < 10) {
      try {
        if (await holdCrop(bot)) {
          if (bot.usingHeldItem || !spawned || !bot.canEat) return
          console.log('eating')
          await bot.consume()
        }
      } catch (e) {
        console.log('error eating', e)
      }
    }
  })


  // Log errors and kick reasons:
  bot.on('kicked', console.log)
  bot.on('error', (e) => console.log('error:', e))
  bot.on('end', r => {
    console.log('kicked', r)
    onServer = false
    setTimeout(() => {
      bot = makeBot()
      start()
    }, 3500)
  })
  setTimeout(() => {
    if (!spawned && !onServer) {
      console.log('didn\'t spawn, restarting')
      try {
        bot.quit()
      } catch { }
      setTimeout(() => {
        bot = makeBot()
        start()
      }, 3500)
    }
  }, 10000)

  bot.canEat = true
}

start()

async function updateDiscordStatus() {
  if (bot) {
    const potatoCount: number | null = await getPotatoCount(bot)
    if (potatoCount !== null && discord.user)
      discord.user.setActivity(`${potatoCount.toLocaleString()} potatoes mined`, { type: 'WATCHING' })
  }
}

let oldChannelTopic: string | null = null
async function updateDiscordChannelDescription() {
  if (!bot || !discord) return
  const onlinePlayers: string[] = Object.keys(bot.players).map(p => p.replace(/_/g, '\\_')).sort((a, b) => a.localeCompare(b))
  const channelTopic = (onlinePlayers.length > 0) ? `Online players (${onlinePlayers.length}): ${onlinePlayers.join(', ')}.` : 'No players online.'
  if (!discord) return
  const channel = await getChannel()
  if (!channel) return
  // don't send an api request if the topic is the same
  if (oldChannelTopic === channelTopic) return
  oldChannelTopic = channelTopic
  try {
    await channel.setTopic(channelTopic)
    console.log('updated topic:', channelTopic)
  } catch (e) {
    console.error(e)
  }

}
setInterval(updateDiscordStatus, 60000)
setInterval(updateDiscordChannelDescription, 60000)

declare module 'mineflayer' {
  interface Bot {
    canEat: boolean
    usingHeldItem: boolean
  }
}
