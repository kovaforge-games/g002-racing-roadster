// The 3D model for a race class: the Roadster body (with its active wing), or one of the other Teslas.
import { CarModel } from './carModel';
import { TeslaModel } from './teslaModel';
import { CLASSES, type ClassId } from '../sim/classes';

export type BodyModel = CarModel | TeslaModel;

export function buildModel(cls: ClassId): BodyModel {
  const c = CLASSES[cls];
  return c.body === 'roadster' ? new CarModel() : new TeslaModel(c.body, c.spec);
}
