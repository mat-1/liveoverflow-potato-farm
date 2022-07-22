import mineflayer, { Bot } from 'mineflayer'
import { Block } from 'prismarine-block'
import { Item } from 'prismarine-item'
import { Vec3 } from 'vec3'
import { holdCrop } from './farm'
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
export function gotoWithCheck(bot: Bot, pos: Vec3, isAtTarget: (pos: Vec3) => boolean, sprint = true): Promise<void> {
	console.log('going to pos', pos)

	if (cancelGoto)
		// cancel the previous goto so we're not going to two places at once
		cancelGoto(bot)

	// 0.5 so the bot goes to the middle
	lookAt(bot, pos.offset(0.5, 0, 0.5))

	if (cancelGoto)
		// cancel the previous goto so we're not going to two places at once
		cancelGoto(bot)


	if (isAtTarget(bot.entity.position))
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

		// @ts-expect-error usingHeldItem doesn't have typings
		if (!bot.usingHeldItem && isAtTarget(bot.entity.position)) {
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


export async function goto(bot: Bot, pos: Vec3, sprint = true): Promise<void> {
	const { x: targetX, z: targetZ } = pos.floored()
	await gotoWithCheck(bot, pos, (botPos: Vec3) => {
		const { x: botX, z: botZ } = botPos.floored()
		return botX === targetX && botZ === targetZ
	}, sprint)
}


export async function gotoNear(bot: Bot, pos: Vec3, range: number, sprint = true): Promise<void> {
	await gotoWithCheck(bot, pos, (botPos: Vec3) => {
		return Math.abs(botPos.x - pos.x) <= range && Math.abs(botPos.z - pos.z) <= range
	}, sprint)
}


export async function eatUntilFull(bot: Bot) {
	// @ts-expect-error usingHeldItem doesn't have typings
	if (bot.usingHeldItem || !bot.canEat) return
	if ((bot.health < 20 && bot.food < 20) || bot.food < 10) {
		try {
			if (await holdCrop(bot)) {
				while (bot.food < 20) {
					// @ts-expect-error usingHeldItem doesn't have typings
					if (bot.usingHeldItem || !bot.canEat) return
					await bot.consume()
				}
			}
		} catch (e) {
			console.log('error eating', e)
		}
	}
}


function parseStatisticsPacket(bot: Bot, packet: any): Record<string, number> {
	const [{ entries: packetData }] = packet
	if (bot.supportFeature('statisticsFormatChanges')) {
		return packetData
	}

	return Object
		.values(packetData)
		.reduce((acc: any, { name, value }: any) => {
			acc[name] = value
			return acc
		}, {}) as Record<string, number>
}

export async function requestStatistics(bot: Bot) {
	if (bot.supportFeature('statisticsUsesPayload')) {
		bot._client.write('client_command', { payload: 1 })
	} else {
		bot._client.write('client_command', { actionId: 1 })
	}

	const packet = await new Promise(resolve => bot._client.once('statistics', resolve))
	return parseStatisticsPacket(bot, packet)
}
