import mineflayer, { Bot } from 'mineflayer'
import { Block } from 'prismarine-block'
import { Item } from 'prismarine-item'
import { Vec3 } from 'vec3'
import { START_POS } from './farm/constants'


let currentYaw = 0
export async function lookAt(bot: Bot, pos: Vec3) {
  const delta = pos.minus(bot.entity.position.offset(0, bot.entity.height, 0))
  const yaw = Math.atan2(-delta.x, -delta.z)
  if (currentYaw === yaw) return
  // const pitch = Math.atan2(delta.y, groundDistance)
  currentYaw = yaw
  await bot.look(yaw, 0, true)
}

export let cancelGoto: null | ((bot: Bot) => void) = null
export function goto(bot: Bot, pos: Vec3, sprint = true): Promise<void> {
  console.log('going to pos', pos)

  if (cancelGoto)
    // cancel the previous goto so we're not going to two places at once
    cancelGoto(bot)

  // 0.5 so the bot goes to the middle
  lookAt(bot, pos.offset(0.5, 0, 0.5))

  if (cancelGoto)
    // cancel the previous goto so we're not going to two places at once
    cancelGoto(bot)


  const { x: targetX, z: targetZ } = pos.floored()

  const isAtTarget = (botX: number, botZ: number) => {
    return botX === targetX && botZ === targetZ
  }

  const { x: botX, z: botZ } = bot.entity.position.floored()
  if (isAtTarget(botX, botZ))
    return new Promise(resolve => resolve())

  bot.setControlState('forward', true)
  if (sprint)
    bot.setControlState('sprint', true)

  let active = true
  let resolveFn: ((...args: any[]) => any)
  const tickListener = () => {
    if (!active) {
      bot.removeListener('physicsTick', tickListener)
      console.log('not active')
    }
    lookAt(bot, pos.offset(0.5, 0, 0.5))

    const { x: botX, z: botZ } = bot.entity.position.floored()
    // @ts-expect-error usingHeldItem doesn't have typings
    if (!bot.usingHeldItem && isAtTarget(botX, botZ)) {
      if (!cancelGoto)
        throw Error('no cancelgoto??')
      cancelGoto(bot)
      console.log('got to pos', pos)
    }
  }
  cancelGoto = (bot) => {
    if (active) {
      bot.setControlState('forward', false)
      bot.setControlState('sprint', false)
      bot.removeListener('physicsTick', tickListener)
      active = false
      resolveFn()
    }
  }

  bot.on('physicsTick', tickListener)

  return new Promise((resolve) => {
    resolveFn = resolve
  })
}

