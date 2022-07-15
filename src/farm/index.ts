import { Bot } from 'mineflayer'
import { Block } from 'prismarine-block'
import { Item } from 'prismarine-item'
import { Vec3 } from 'vec3'
import { cancelGoto, goto } from '../utils'
import { END_POS, FARM_LENGTH, FARM_WIDTH, START_POS, STRIP_WIDTH } from './constants'



export async function startFarming(bot: Bot) {
	// pre-calculations
	const lineCount = Math.abs(END_POS.x - START_POS.x)
	const validLines: number[] = []
	for (let line = 0; line < lineCount; line++) {
		if (shouldVisitLine(bot, line))
			validLines.push(line)
	}
	let currentValidLines = validLines

	// bot will start farming now
	while (true) {
		const startLine = currentValidLines.shift()
		if (startLine === undefined)
			throw new Error('no valid lines')
		const endLine = Math.min(startLine + STRIP_WIDTH - 1, FARM_WIDTH)
		const centerLine = endLine + (startLine - endLine) / 2

		console.log('startLine', startLine)
		console.log('centerLine', centerLine)
		console.log('endLine', endLine)

		if (startLine > FARM_WIDTH)
			break

		// get rid of all the lines that we're gonna be farming from currentValidLines
		currentValidLines = currentValidLines.filter(line => line > endLine)

		await gotoLineAndIndex(bot, centerLine, 0)
		const gotoEndLinePromise = gotoLineAndIndex(bot, centerLine, FARM_LENGTH)

		let index = 0
		let paused = false
		let tickListener = async () => {
			// we pause while doing async stuff
			if (paused) return

			let willVisitAll = true
			for (let line = startLine; line <= endLine; line++) {
				const block = blockAtLineAndIndex(bot, line, index)
				if (!block)
					throw new Error('no block at line ' + line + ' index ' + index)
				if (!canReachBlock(bot, block))
					willVisitAll = false
			}
			if (!willVisitAll)
				// wait until we get closer
				return

			paused = true

			// digging crops
			for (let line = startLine; line <= endLine; line++) {
				const block = blockAtLineAndIndex(bot, line, index)
				if (!block)
					throw new Error('no block at line ' + line + ' index ' + index)

				if (canReachBlock(bot, block)) {
					if (isFullyGrownCrop(block)) {
						await holdCrop(bot)
						try {
							await bot.dig(block, 'ignore')
						} catch (e) {
							console.log('error digging', e)
						}
					}
				}
			}

			// tilling
			for (let line = startLine; line <= endLine; line++) {
				const block = blockAtLineAndIndex(bot, line, index)
				if (!block)
					throw new Error('no block at line ' + line + ' index ' + index)

				if (canReachBlock(bot, block)) {
					if (block.name === 'air') {
						const blockBelow = bot.blockAt(block.position.offset(0, -1, 0))
						if (!blockBelow) throw new Error('no block below')
						if (blockBelow.name === 'dirt') {
							if (!await holdHoe(bot))
								throw new Error('no hoes?')
							activateBlock(bot, blockBelow)
						}
					}
				}
			}

			// placing
			for (let line = startLine; line <= endLine; line++) {
				const block = blockAtLineAndIndex(bot, line, index)
				if (!block)
					throw new Error('no block at line ' + line + ' index ' + index)

				if (canReachBlock(bot, block)) {
					const blockBelow = bot.blockAt(block.position.offset(0, -1, 0))
					if (!blockBelow) throw new Error('no block below')
					if (await holdCrop(bot))
						activateBlock(bot, blockBelow)
				}
			}

			paused = false

			index++
		}

		bot.addListener('physicsTick', tickListener)
		await gotoEndLinePromise
		bot.removeListener('physicsTick', tickListener)

		// finished doing strip, now go back and pick up the items

		// TODO: skip indexes that don't have items
		index = 0
		while (index < FARM_LENGTH) {
			await gotoLineAndIndex(bot, startLine, FARM_LENGTH - index)
			index += 2
			await gotoLineAndIndex(bot, endLine, FARM_LENGTH - index)
			index += 2
		}
		await gotoLineAndIndex(bot, startLine, 0)
	}
}




function getLineAndIndexPos(line: number, index: number) {
	return new Vec3(START_POS.x - line, START_POS.y, START_POS.z + index)
}

function shouldVisit(bot: Bot, block: Block) {
	if (isFullyGrownCrop(block))
		return true
	const blockBelow = bot.blockAt(block.position.offset(0, -1, 0))
	if (!blockBelow) throw new Error('no block below')
	console.log('blockBelow', blockBelow.name)
	if (blockBelow.name === 'dirt' || blockBelow.name === 'farmland')
		return true
	return false
}

function isFullyGrownCrop(block: Block) {
	if (block.name === 'potatoes' && block.getProperties().age === 7)
		return true
	return false
}

function shouldVisitLine(bot: Bot, line: number) {
	for (let index = 0; index < FARM_WIDTH; index++) {
		const block = blockAtLineAndIndex(bot, line, index)
		if (!block)
			throw new Error('no block at line ' + line + ' index ' + index)
		if (shouldVisit(bot, block))
			return true
	}
	return false
}

function blockAtLineAndIndex(bot: Bot, line: number, index: number) {
	return bot.blockAt(getLineAndIndexPos(line, index))
}

async function gotoLineAndIndex(bot: Bot, line: number, index: number) {
	const pos = getLineAndIndexPos(line, index)
	await goto(bot, pos, true)
}

async function holdHoe(bot: Bot) {
	if (bot.heldItem?.name.endsWith('_hoe'))
		return true
	for (const item of bot.inventory.items()) {
		if (item.name.endsWith('_hoe')) {
			await bot.equip(item, 'hand')
			return true
		}
	}

	return false
}

async function holdCrop(bot: Bot) {
	if (bot.heldItem?.name === 'potato')
		return true
	for (const item of bot.inventory.items()) {
		if (item.name === 'potato') {
			await bot.equip(item, 'hand')
			return true
		}
	}

	return false
}


async function activateBlock(bot: Bot, block: Block) {
	bot._client.write('block_place', {
		location: block.position,
		direction: 1,
		hand: 0,
		cursorX: 0.5,
		cursorY: 0.5,
		cursorZ: 0.5,
		insideBlock: false
	})
}

// code from bot.canDigBlock
function canReachBlock(bot: Bot, block: Block) {
	return block.position.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position.offset(0, 1.65, 0)) <= 5.1
}