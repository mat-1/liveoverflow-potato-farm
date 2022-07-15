import { DISCORD_TOKEN, DISCORD_CHANNEL_ID, SERVER_IP, EMAIL } from './config.json'
import mineflayer, { Bot } from 'mineflayer'
import { Block } from 'prismarine-block'
import { Item } from 'prismarine-item'
import { Vec3 } from 'vec3'
import { Client, Intents } from 'discord.js'

let [ HOST, PORT ] = SERVER_IP.split(':')
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
    viewDistance: 'short' // 8 chunks
  })
}

let bot = makeBot()

const discord = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

discord.once('ready', () => {
	console.log('Discord bot ready')
})

discord.login(DISCORD_TOKEN)

discord.on('messageCreate', m => {
  if (m.channel.id !== DISCORD_CHANNEL_ID || m.author.bot) return

  const msg = `${m.author.username}#${m.author.discriminator}: ${m.cleanContent.replace(/​/g, '')}`.replace(/\n/g, ' ')
//   public static boolean isAllowedChatCharacter(char var0) {
//     return var0 != 167 && var0 >= ' ' && var0 != 127;
//  }
  if (msg.length > 256 || msg.startsWith('/') || /[\x00-\x1F\x7F\xA7]/.test(msg)) {
    m.react('🚫')
  } else {
    bot.chat(msg.replace(/\n/g, ' '))
    m.react('👍')
  }
})

// this shouldn't have any decimals
const startPos = new Vec3(-16, 64, 79)
const endPos = new Vec3(-105, 64, 162)

let currentYaw = 0
async function lookAt(bot: Bot, pos: Vec3) {
  const delta = pos.minus(bot.entity.position.offset(0, bot.entity.height, 0))
  const yaw = Math.atan2(-delta.x, -delta.z)
  if (currentYaw === yaw) return
  // const pitch = Math.atan2(delta.y, groundDistance)
  currentYaw = yaw
  await bot.look(yaw, 0, true)
}

let cancelGoto: null | ((bot: Bot) => void) = null
function goto(bot: Bot, pos: Vec3) {
  console.log('going to pos', pos)

  if (cancelGoto)
    // cancel the previous goto so we're not going to two places at once
    cancelGoto(bot)

  // 0.5 so the bot goes to the middle
  lookAt(bot, pos.offset(0.5, 0, 0.5))
  console.log('looking at', pos.offset(0.5, 0, 0.5))

  if (cancelGoto)
    // cancel the previous goto so we're not going to two places at once
    cancelGoto(bot)


  console.log('going to pos', pos)
  const { x: targetX, z: targetZ } = pos.floored()

  const isAtTarget = (botX: number, botZ: number) => (botX === targetX && botZ === targetZ)

  const { x: botX, z: botZ } = bot.entity.position.floored()
  if (isAtTarget(botX, botZ))
    return

  bot.setControlState('forward', true)
  bot.setControlState('sprint', true)

  let active = true
  let resolveFn: ((...args: any[]) => any)
  const tickListener = () => {
    if (!active) {
      bot.removeListener('physicsTick', tickListener)
      console.log('not active')
    }
    lookAt(bot, pos)

    const { x: botX, z: botZ } = bot.entity.position.floored()
    if (!bot.usingHeldItem && isAtTarget(botX, botZ)) {
      if (!cancelGoto)
        throw Error('no cancelgoto??')
      cancelGoto(bot)
      console.log('got to pos', pos)
    }
  }
  console.log('set new cancelGoto')
  cancelGoto = (bot) => {
    if (active) {
      bot.setControlState('forward', false)
      bot.setControlState('sprint', false)
      bot.removeListener('physicsTick', tickListener)
      active = false
      console.log('canceled goto')
      resolveFn()
    }
  }

  console.log('made listener')
  bot.on('physicsTick', tickListener)

  return new Promise((resolve) => {
    resolveFn = resolve
  })
}

function gotoRow(bot: Bot, row: number) {
  const pos = startPos.plus(new Vec3(0, 0, row))
  console.log(pos)
  return goto(bot, pos)
}

function isValidCrop(block: Block | null) {
  if (!block) return
  return block.name === 'potatoes' && block.getProperties().age === 7
}

function findNextSpot(bot: Bot, row: number) {
  const zPos = startPos.z + row
  for (let x = startPos.x; x >= endPos.x; x--) {
    const pos = new Vec3(x, startPos.y, zPos)
    const block = bot.blockAt(pos)
    if (block && isValidCrop(block)) {
      return pos
    }
    // also go to places where crops were destroyed
    if (block && block.name === 'air') {
      const blockBelow = bot.blockAt(pos.offset(0, -1, 0))
      if (blockBelow && (blockBelow.name === 'dirt' || blockBelow.name === 'farmland'))
        return pos
    }
  }
  return null
}

function putItemInHotbar(bot: Bot, item: Item, slot: number) {
  const currentHotbarSlotItem = bot.inventory.slots[bot.inventory.hotbarStart + slot]
}

function holdCrop(bot: Bot) {

}


/**
 * The main function for farming.
 */
async function startFarming(bot: Bot) {
  let row = 0
  // await gotoRow(bot, row)
  while (true) {
    const targetPos = findNextSpot(bot, row)
    console.log('! targetPos', targetPos)
    if (!targetPos) {
      console.log('no crops found')
      row += 1
      // await gotoRow(bot, row)
      if (row >= Math.ceil(endPos.z - startPos.z)) {
        console.log('done farming!')
        return
      }
      continue
    }
    goto(bot, targetPos)
    const targetBlock = bot.blockAt(targetPos)
    if (!targetBlock) {
      console.log('no block found')
      return
    }

    const digPromise = new Promise((resolve) => {
      const tickListener = async () => {
        if (bot.usingHeldItem) return
        if (!bot.canDigBlock(targetBlock)) return
        bot.removeListener('physicsTick', tickListener)
        if (cancelGoto)
          cancelGoto(bot)
        if (targetBlock.name !== 'air')
          await bot.dig(targetBlock)
        const blockBelow = bot.blockAt(targetBlock.position.offset(0, -1, 0))
        if (blockBelow) {
          if (blockBelow.name === 'dirt') {
            // TODO: hold a hoe and till it
          }
          await bot.activateBlock(blockBelow)
        }
        bot.moveSlotItem
        resolve(undefined)
      }
      bot.on('physicsTick', tickListener)
    })

    await digPromise
  }
}

async function sendInDiscord(message: string) {
  if (!discord) return
  const channel = discord.channels.cache.get(DISCORD_CHANNEL_ID) || (await discord.channels.fetch(DISCORD_CHANNEL_ID))
  if (!channel) {
    console.log('no channel')
    return
  }
  if (channel.type !== 'GUILD_TEXT') {
    console.log('channel is not text')
    return
  }
  await channel.send({
    content: message,
    allowedMentions: {
      parse: [],
      users: [],
      roles: []
    }
  })
}

function start() {
  let spawned = false

  bot.on('spawn', () => {
    if (!spawned)
      // wait for chunks to load and stuff
      // setTimeout(() => startFarming(bot), 2000)

    spawned = true
    console.log('spawned')

  })

  const USERNAME_REGEX = '(?:\\(.+\\)|\\[.+\\]|.)*?(\\w+)'
  const WHISPER_REGEX = new RegExp(`^${USERNAME_REGEX} whispers(?: to you)?:? (.*)$`)

  bot.on('messagestr', (m, position) => {
    if (position === 'game_info') return
    if (m === 'matdoesdev joined the game') return
    if (m.startsWith(`<${bot.username}> `)) return
    if (WHISPER_REGEX.test(m)) return
    console.log('message', m)
    sendInDiscord(m)
  })


  bot.on('chat', (username, message) => {
    console.log(username, message)
    if (username === bot.username) return
  })

  bot.on('whisper', (username, message) => {
    if (username === 'py5') {
      const [command, ...args] = message.split(' ')
      console.log(command, args)
      switch (command) {
        case 'goto':
          const [x, y, z] = args
          const pos = new Vec3(+x, +y, +z)
          goto(bot, pos)
          break
        case 'gotoRow':
          const row = Number(args[0])
          gotoRow(bot, row)
          break
      }
    }
  })

  bot.on('health', async () => {
    if (bot.usingHeldItem || !spawned) return
    if (bot.health < 20 && bot.food < 20) {
      try {
        await bot.consume()
      } catch {

      }
    }
  })


  // Log errors and kick reasons:
  bot.on('kicked', console.log)
  bot.on('error', console.log)
  bot.on('end', r => {
    console.log('kicked', r)
    setTimeout(() => {
      bot = makeBot()
      start()
    }, 1000)
  })
}

start()
