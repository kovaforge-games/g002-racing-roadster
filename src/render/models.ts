// The 3D model for a race class: the roadster body for road cars, the single-seater for the 0x classes.
import { CarModel } from './carModel';
import { OpenWheelModel } from './openWheel';
import { CLASSES, type ClassId } from '../sim/classes';

export type BodyModel = CarModel | OpenWheelModel;

export function buildModel(cls: ClassId): BodyModel {
  const c = CLASSES[cls];
  return c.body === 'open' ? new OpenWheelModel(c.spec) : new CarModel();
}
