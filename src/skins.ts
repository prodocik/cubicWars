export interface CharSkin {
  name: string;
  skin: string;
  skinDark: string;
  hair: string;
  shirt: string;
  shirtLight: string;
  belt: string;
  buckle: string;
  pants: string;
  boots: string;
  bootsTop: string;
  bald?: boolean;
  beard?: string;         // beard color
  stripes?: string;       // horizontal stripe color for shirt
  hat?: "wizard" | "mohawk"; // special headgear
  hatColor?: string;
  hatColor2?: string;     // secondary hat color
  longHair?: boolean;     // long hair past shoulders
  robe?: boolean;         // robe instead of pants (covers legs)
  robeColor?: string;
  tusks?: boolean;        // orc tusks
  blush?: string;         // cheek blush color
  bow?: string;           // hair bow color
}

export const SKINS: CharSkin[] = [
  {
    name: "Warrior",
    skin: "#e8b88a", skinDark: "#d4a070",
    hair: "#4a3020",
    shirt: "#8b2020", shirtLight: "#a03030",
    belt: "#5a4020", buckle: "#c8a840",
    pants: "#4a4040",
    boots: "#3a2818", bootsTop: "#4a3828",
  },
  {
    name: "Mage",
    skin: "#f0d0b0", skinDark: "#dab890",
    hair: "#e8e8f0",
    shirt: "#2040a0", shirtLight: "#3060c0",
    belt: "#6030a0", buckle: "#b060ff",
    pants: "#282848",
    boots: "#1a1a3a", bootsTop: "#2a2a4a",
  },
  {
    name: "Ranger",
    skin: "#c89070", skinDark: "#b07858",
    hair: "#2a4020",
    shirt: "#2a6030", shirtLight: "#3a8040",
    belt: "#5a4020", buckle: "#a0a0a0",
    pants: "#3a3020",
    boots: "#2a2018", bootsTop: "#3a3028",
  },
  {
    name: "Knight",
    skin: "#e8c0a0", skinDark: "#d0a888",
    hair: "#c8a040",
    shirt: "#707080", shirtLight: "#9090a0",
    belt: "#505060", buckle: "#f0d040",
    pants: "#404050",
    boots: "#303040", bootsTop: "#404050",
  },
  {
    name: "Rogue",
    skin: "#d8a878", skinDark: "#c09060",
    hair: "#1a1a1a",
    shirt: "#2a2a2a", shirtLight: "#3a3a3a",
    belt: "#4a3020", buckle: "#c0c0c0",
    pants: "#1a1a20",
    boots: "#101018", bootsTop: "#1a1a22",
  },
  {
    name: "Cleric",
    skin: "#f0c8a0", skinDark: "#d8b088",
    hair: "#a06030",
    shirt: "#c0b080", shirtLight: "#d8c898",
    belt: "#806030", buckle: "#f0e060",
    pants: "#706048",
    boots: "#504030", bootsTop: "#605040",
  },
  {
    name: "Orc",
    skin: "#5a8a40", skinDark: "#487030",
    hair: "#1a1a1a",
    bald: true,
    tusks: true,
    shirt: "#4a3020", shirtLight: "#5a4030",
    belt: "#3a2a1a", buckle: "#806020",
    pants: "#3a2a1a",
    boots: "#2a1a10", bootsTop: "#3a2a18",
  },
  {
    name: "Archmage",
    skin: "#f0d0b0", skinDark: "#dab890",
    hair: "#c0c0d0",
    hat: "wizard", hatColor: "#2a1060", hatColor2: "#f0d040",
    beard: "#c0c0d0",
    robe: true, robeColor: "#2a1060",
    shirt: "#3020a0", shirtLight: "#4030c0",
    belt: "#806030", buckle: "#f0d040",
    pants: "#2a1060",
    boots: "#1a1040", bootsTop: "#2a2050",
  },
  {
    name: "Punk",
    skin: "#e0b080", skinDark: "#c89868",
    hair: "#ff2080",
    hat: "mohawk", hatColor: "#ff2080", hatColor2: "#ff60a0",
    shirt: "#1a1a1a", shirtLight: "#2a2a2a",
    stripes: "#ff2020",
    belt: "#4a4a4a", buckle: "#c0c0c0",
    pants: "#101010",
    boots: "#1a1a1a", bootsTop: "#333333",
  },
  {
    name: "Girl (Redhead)",
    skin: "#f0c8a8", skinDark: "#dab090",
    hair: "#c04020",
    longHair: true,
    blush: "#f0a0a0",
    bow: "#ff6080",
    shirt: "#e06080", shirtLight: "#f080a0",
    belt: "#a04060", buckle: "#f0c0d0",
    pants: "#504060",
    boots: "#603050", bootsTop: "#704060",
  },
  {
    name: "Girl (Blonde)",
    skin: "#f8d8b8", skinDark: "#e0c0a0",
    hair: "#f0d060",
    longHair: true,
    blush: "#f8b0b0",
    bow: "#60a0f0",
    shirt: "#60a0e0", shirtLight: "#80c0f0",
    belt: "#4080b0", buckle: "#c0e0f0",
    pants: "#3a5070",
    boots: "#2a3a50", bootsTop: "#3a4a60",
  },
  {
    name: "Girl (Dark)",
    skin: "#b07848", skinDark: "#986038",
    hair: "#1a1018",
    longHair: true,
    blush: "#c08868",
    bow: "#a040c0",
    shirt: "#a040c0", shirtLight: "#c060e0",
    belt: "#603080", buckle: "#d0a0f0",
    pants: "#2a1840",
    boots: "#1a1030", bootsTop: "#2a1840",
  },
  {
    name: "Sailor",
    skin: "#e8b88a", skinDark: "#d4a070",
    hair: "#e8b88a", // same as skin (bald)
    bald: true,
    beard: "#5a4030",
    shirt: "#ffffff", shirtLight: "#f0f0f0",
    stripes: "#1a3a80", // тельняшка
    belt: "#3a3a3a", buckle: "#808080",
    pants: "#2a2a3a",
    boots: "#1a1a1a", bootsTop: "#2a2a2a",
  },
];

// frame: 0 = idle, 1-4 = walk cycle
export function drawCharacter(ctx: CanvasRenderingContext2D, s: CharSkin, frame = 0) {
  // Walk cycle offsets
  // Legs: [leftLegY, rightLegY, leftFootY, rightFootY]
  // Arms: [leftArmY, rightArmY]
  const walkFrames = [
    { lly: 0, rly: 0, lfy: 0, rfy: 0, lay: 0, ray: 0, bob: 0 },  // idle
    { lly: -2, rly: 1, lfy: -2, rfy: 1, lay: 1, ray: -1, bob: -1 },  // walk 1
    { lly: 0, rly: 0, lfy: 0, rfy: 0, lay: 0, ray: 0, bob: 0 },  // walk 2 (passing)
    { lly: 1, rly: -2, lfy: 1, rfy: -2, lay: -1, ray: 1, bob: -1 },  // walk 3
    { lly: 0, rly: 0, lfy: 0, rfy: 0, lay: 0, ray: 0, bob: 0 },  // walk 4 (passing)
  ];
  const f = walkFrames[frame] || walkFrames[0];

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.beginPath();
  ctx.ellipse(8, 30, 6, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body bob offset
  const by = f.bob;

  // Head
  ctx.fillStyle = s.skin;
  ctx.fillRect(4, 0 + by, 8, 8);
  ctx.fillStyle = s.skinDark;
  ctx.fillRect(4, 6 + by, 8, 2);

  // Hair (skip if bald)
  if (!s.bald && s.hat !== "mohawk") {
    ctx.fillStyle = s.hair;
    ctx.fillRect(4, 0 + by, 8, 3);
    ctx.fillRect(3, 1 + by, 1, 4);
    ctx.fillRect(12, 1 + by, 1, 4);
    // Long hair flows down past shoulders
    if (s.longHair) {
      ctx.fillRect(3, 1 + by, 1, 10);
      ctx.fillRect(2, 3 + by, 1, 9);
      ctx.fillRect(12, 1 + by, 1, 10);
      ctx.fillRect(13, 3 + by, 1, 9);
    }
  }

  // Wizard hat
  if (s.hat === "wizard") {
    ctx.fillStyle = s.hatColor || "#2a1060";
    ctx.fillRect(3, -1 + by, 10, 3);   // brim
    ctx.fillRect(5, -4 + by, 6, 3);    // middle
    ctx.fillRect(6, -7 + by, 4, 3);    // top
    ctx.fillRect(7, -9 + by, 2, 2);    // tip
    // Star on hat
    ctx.fillStyle = s.hatColor2 || "#f0d040";
    ctx.fillRect(7, -5 + by, 2, 2);
  }

  // Mohawk
  if (s.hat === "mohawk") {
    ctx.fillStyle = s.hair;
    ctx.fillRect(3, 1 + by, 1, 3);
    ctx.fillRect(12, 1 + by, 1, 3);
    ctx.fillStyle = s.hatColor || "#ff2080";
    ctx.fillRect(6, -4 + by, 4, 4);
    ctx.fillRect(7, -6 + by, 2, 2);
    ctx.fillStyle = s.hatColor2 || "#ff60a0";
    ctx.fillRect(7, -4 + by, 2, 2);
  }

  // Hair bow
  if (s.bow) {
    ctx.fillStyle = s.bow;
    ctx.fillRect(11, 1 + by, 3, 2);
    ctx.fillRect(12, 0 + by, 1, 1);
    ctx.fillRect(12, 3 + by, 1, 1);
  }

  // Eyes
  ctx.fillStyle = "#222";
  ctx.fillRect(6, 4 + by, 1, 1);
  ctx.fillRect(9, 4 + by, 1, 1);

  // Blush
  if (s.blush) {
    ctx.fillStyle = s.blush;
    ctx.globalAlpha = 0.4;
    ctx.fillRect(5, 5 + by, 2, 1);
    ctx.fillRect(9, 5 + by, 2, 1);
    ctx.globalAlpha = 1;
  }

  // Tusks
  if (s.tusks) {
    ctx.fillStyle = "#e8e0c0";
    ctx.fillRect(5, 7 + by, 1, 2);
    ctx.fillRect(10, 7 + by, 1, 2);
  }

  // Beard
  if (s.beard) {
    ctx.fillStyle = s.beard;
    ctx.fillRect(5, 6 + by, 6, 3);
    ctx.fillRect(6, 9 + by, 4, 1);
  }

  // Shirt
  ctx.fillStyle = s.shirt;
  ctx.fillRect(3, 8 + by, 10, 10);
  ctx.fillStyle = s.shirtLight;
  ctx.fillRect(5, 8 + by, 6, 10);

  // Stripes (тельняшка)
  if (s.stripes) {
    ctx.fillStyle = s.stripes;
    for (let sy = 0; sy < 10; sy += 3) {
      ctx.fillRect(3, 8 + by + sy, 10, 1);
    }
  }

  // Belt
  ctx.fillStyle = s.belt;
  ctx.fillRect(3, 16 + by, 10, 2);
  ctx.fillStyle = s.buckle;
  ctx.fillRect(7, 16 + by, 2, 2);

  // Left arm
  ctx.fillStyle = s.shirt;
  ctx.fillRect(1, 9 + by + f.lay, 2, 7);
  ctx.fillStyle = s.skin;
  ctx.fillRect(1, 16 + by + f.lay, 2, 2);

  // Right arm
  ctx.fillStyle = s.shirt;
  ctx.fillRect(13, 9 + by + f.ray, 2, 7);
  ctx.fillStyle = s.skin;
  ctx.fillRect(13, 16 + by + f.ray, 2, 2);

  // Robe or legs
  if (s.robe) {
    // Robe covers legs — flowy bottom
    ctx.fillStyle = s.robeColor || s.shirt;
    ctx.fillRect(3, 18 + by, 10, 9);
    ctx.fillRect(2, 24 + by, 12, 3);
    // Robe hem highlight
    ctx.fillStyle = s.shirtLight;
    ctx.fillRect(3, 26 + by, 10, 1);
    // Boots peek out
    ctx.fillStyle = s.boots;
    ctx.fillRect(4, 27 + f.lfy, 3, 5);
    ctx.fillRect(9, 27 + f.rfy, 3, 5);
  } else {
    // Left leg
    ctx.fillStyle = s.pants;
    ctx.fillRect(4, 18 + by + f.lly, 4, 10);

    // Right leg
    ctx.fillStyle = s.pants;
    ctx.fillRect(8, 18 + by + f.rly, 4, 10);

    // Left boot
    ctx.fillStyle = s.boots;
    ctx.fillRect(3, 27 + f.lfy, 5, 5);
    ctx.fillStyle = s.bootsTop;
    ctx.fillRect(3, 27 + f.lfy, 5, 2);

    // Right boot
    ctx.fillStyle = s.boots;
    ctx.fillRect(8, 27 + f.rfy, 5, 5);
    ctx.fillStyle = s.bootsTop;
    ctx.fillRect(8, 27 + f.rfy, 5, 2);
  }
}
