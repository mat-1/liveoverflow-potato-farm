import { Bot } from 'mineflayer'
import { Block } from 'prismarine-block'
import { Item } from 'prismarine-item'
import windowLoader from 'prismarine-windows'
import { Vec3 } from 'vec3'
import { cancelGoto, eatUntilFull, goto, gotoNear } from '../utils'
import { DEPOSIT_CHEST, END_POS, FARM_LENGTH, FARM_WIDTH, START_POS, STORAGE_AREA, STRIP_WIDTH } from './constants'

const { Window } = windowLoader('1.18.2')


export async function startFarming(bot: Bot) {
	// if we're close to running out of slots, deposit our stuff
	if (bot.inventory.emptySlotCount() <= 2) {
		await depositInventory(bot)
	}

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
		bot.canEat = false
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
			if (!willVisitAll) {
				// wait until we get closer
				return
			}
			console.log('ok')

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
								// no hoes?
								break
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
					if (blockBelow.name === 'farmland' && await holdCrop(bot))
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
			// if we're close to running out of slots, deposit our stuff
			if (bot.inventory.emptySlotCount() <= 2) {
				await depositInventory(bot)
			}

			bot.canEat = true
			await gotoLineAndIndex(bot, startLine, FARM_LENGTH - index)
			index += 1.5
			await gotoLineAndIndex(bot, endLine, FARM_LENGTH - index)
			index += 1.5
			bot.canEat = false
		}
		await gotoLineAndIndex(bot, startLine, 0)

		// if we're close to running out of slots, deposit our stuff
		if (bot.inventory.emptySlotCount() <= 2) {
			await depositInventory(bot)
		}

		bot.canEat = true
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
			bot.updateHeldItem()
			return true
		}
	}

	return false
}

export async function holdCrop(bot: Bot) {

	if (bot.heldItem?.name === 'potato') {
		return true
	} for (const item of bot.inventory.items()) {
		if (item.name === 'potato') {
			await bot.equip(item, 'hand')
			bot.updateHeldItem()
			console.log('ok holding potato')
			return true
		}
	}

	console.log('no potato')
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


const cachedChestHasSpace: Map<string, boolean> = new Map()
async function openIfChestHasSpace(bot: Bot, chestBlock: Block): Promise<typeof Window | undefined> {
	const positionKey = chestBlock.position.toString()
	if (cachedChestHasSpace.has(positionKey)) {
		// if we remember this chest doesn't have any space, don't open it
		if (!cachedChestHasSpace.get(positionKey))
			return undefined
	}
	await gotoNear(bot, chestBlock.position, 5)
	const chest = await bot.openContainer(chestBlock) as any as typeof Window | undefined
	if (!chest) {
		throw new Error('can\'t open chest')
	}
	console.log('chest.firstEmptyContainerSlot()', chest.firstEmptyContainerSlot())
	const hasSpace = chest.firstEmptyContainerSlot() !== null
	console.log('hasSpace', hasSpace)
	if (!hasSpace) {
		chest.close()
		cachedChestHasSpace.set(positionKey, false)
		return undefined
	}
	cachedChestHasSpace.set(positionKey, true)
	return chest
}

function getPotentialChests(bot: Bot) {
	return bot.findBlocks({
		point: STORAGE_AREA,
		matching: (block) => {
			if (block.name !== 'chest') return false
			// open the left part of double chests
			if (block.getProperties().type !== 'left') return false
			return true
		},
		// make sure we get all the chests
		count: 10000000,
		maxDistance: 64
	})
}

async function openChestWithSpace(bot: Bot): Promise<typeof Window | undefined> {
	// const potentialChests = getPotentialChests(bot)
	// for (const chestPos of potentialChests) {
	// 	const chestBlock = bot.blockAt(chestPos)
	// 	if (!chestBlock) throw new Error('no chest block')
	// 	const chest = await openIfChestHasSpace(bot, chestBlock)
	// 	if (chest) {
	// 		return chest
	// 	}
	// }
	const chestBlock = bot.blockAt(DEPOSIT_CHEST)
	if (!chestBlock) throw new Error('no chest block')
	await gotoNear(bot, chestBlock.position, 5)
	const chest = await bot.openContainer(chestBlock) as any as typeof Window | undefined
	if (!chest) {
		throw new Error('can\'t open chest')
	}
	return chest
}

async function depositInventory(bot: Bot) {
	// first throw away our garbage
	for (const item of bot.inventory.items()) {
		if (!(['diamond_hoe', 'potato'].includes(item.name))) {
			await bot.tossStack(item)
		}
	}
	await eatUntilFull(bot)


	const chest = await openChestWithSpace(bot)
	if (!chest) {
		console.log('No chest with space!')
		return
	}

	let cropItemType
	let cropItemCount = 0
	for (const item of bot.inventory.items()) {
		if (item.name === 'potato') {
			cropItemType = item.type
			cropItemCount += item.count
		}
	}

	if (cropItemType === undefined) {
		console.log('No potato in inventory!')
		return
	}

	cropItemCount -= 64
	if (cropItemCount <= 0) return

	console.log('depositing', cropItemCount)
	try {
		await chest.deposit(cropItemType, null, cropItemCount)
	} catch (e) {
		// if it errored that means the destination is full, so try again
		console.log('Error depositing crop:', e)
		await depositInventory(bot)
	}
}
