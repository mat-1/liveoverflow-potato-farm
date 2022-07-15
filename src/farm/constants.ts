import { Vec3 } from 'vec3'


// export const START_POS = new Vec3(-16, 64, 79)
// export const END_POS = new Vec3(-105, 64, 162)

export const START_POS = new Vec3(16, 64, 8)
export const END_POS = new Vec3(-16, 64, 43)

export const FARM_WIDTH = Math.abs(END_POS.x - START_POS.x)
export const FARM_LENGTH = Math.abs(END_POS.z - START_POS.z)

// how many lines to farm at once
export const STRIP_WIDTH = 7
