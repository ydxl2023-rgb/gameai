import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// Platform binaries and skills are independent of the project that owns task artifacts.
export const platformRoot=fileURLToPath(new URL('../../../',import.meta.url));
export const projectRoot=process.env.GAMEAI_PROJECT_ROOT ? resolve(process.env.GAMEAI_PROJECT_ROOT) : platformRoot;
