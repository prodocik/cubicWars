import * as ex from "excalibur";

import grassUrl from "../assets/sprites/iso/grass.png";
import dirtUrl from "../assets/sprites/iso/dirt.png";
import waterUrl from "../assets/sprites/iso/water.png";
import stoneUrl from "../assets/sprites/iso/stone.png";
import tree0Url from "../assets/sprites/tree0.png";
import tree1Url from "../assets/sprites/tree1.png";
import tree2Url from "../assets/sprites/tree2.png";
import tree3Url from "../assets/sprites/tree3.png";
import stump0Url from "../assets/sprites/stump0.png";
import stump1Url from "../assets/sprites/stump1.png";
import stump2Url from "../assets/sprites/stump2.png";
import stump3Url from "../assets/sprites/stump3.png";
import axeUrl from "../assets/sprites/axe.png";
import logUrl from "../assets/sprites/log.png";
import pickaxeImgUrl from "../assets/sprites/pickaxe.png";
import oreUrl from "../assets/sprites/ore.png";
import chopSound1Url from "../assets/sounds/wood-chop-axe-hit-02.mp3";
import chopSound2Url from "../assets/sounds/wood-chop-axe-hit-03.mp3";
import pickaxeSoundUrl from "../assets/sounds/pickaxe.mp3";

export const Images = {
  grass: new ex.ImageSource(grassUrl),
  dirt: new ex.ImageSource(dirtUrl),
  water: new ex.ImageSource(waterUrl),
  stone: new ex.ImageSource(stoneUrl),
  tree0: new ex.ImageSource(tree0Url),
  tree1: new ex.ImageSource(tree1Url),
  tree2: new ex.ImageSource(tree2Url),
  tree3: new ex.ImageSource(tree3Url),
  stump0: new ex.ImageSource(stump0Url),
  stump1: new ex.ImageSource(stump1Url),
  stump2: new ex.ImageSource(stump2Url),
  stump3: new ex.ImageSource(stump3Url),
  axe: new ex.ImageSource(axeUrl),
  log: new ex.ImageSource(logUrl),
  pickaxeImg: new ex.ImageSource(pickaxeImgUrl),
  ore: new ex.ImageSource(oreUrl),
};

export { axeUrl, logUrl, pickaxeImgUrl, oreUrl };

export const Sounds = {
  chop1: new ex.Sound(chopSound1Url),
  chop2: new ex.Sound(chopSound2Url),
  pickaxe: new ex.Sound(pickaxeSoundUrl),
};

export const loader = new ex.Loader([...Object.values(Images), ...Object.values(Sounds)]);

loader.suppressPlayButton = true;
