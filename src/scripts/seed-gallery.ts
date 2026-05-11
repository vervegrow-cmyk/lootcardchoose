import { prisma } from "../services/prisma.service";

const cards = [
  {
    title: "Black Gold SSR Anime Girl Card",
    description: "黑金SSR动漫女角色卡",
    imageUrl: "https://placehold.co/600x800/png",
    tags: ["黑金", "SSR", "女角色"],
    style: "black gold",
    rarity: "SSR",
    category: "anime",
    character: "female",
    color: "black gold",
    price: "49.99",
    metadata: { seed: true },
  },
  {
    title: "Cyberpunk Mecha Card",
    description: "赛博朋克机甲卡",
    imageUrl: "https://placehold.co/600x800/png",
    tags: ["赛博朋克", "机甲"],
    style: "cyberpunk",
    rarity: "SR",
    category: "mecha",
    character: "mecha",
    color: "neon",
    price: "39.99",
    metadata: { seed: true },
  },
  {
    title: "Dragon Ball Style Card",
    description: "龙珠风格战斗卡",
    imageUrl: "https://placehold.co/600x800/png",
    tags: ["龙珠", "战斗"],
    style: "dragon ball",
    rarity: "SSR",
    category: "anime",
    character: "hero",
    color: "orange",
    price: "59.99",
    metadata: { seed: true },
  },
  {
    title: "Neon Samurai Card",
    description: "霓虹武士风",
    imageUrl: "https://placehold.co/600x800/png",
    tags: ["赛博朋克", "武士"],
    style: "cyberpunk",
    rarity: "SR",
    category: "samurai",
    character: "male",
    color: "neon",
    price: "44.99",
    metadata: { seed: true },
  },
  {
    title: "Arcane Mage Card",
    description: "奥术法师",
    imageUrl: "https://placehold.co/600x800/png",
    tags: ["魔法", "法师"],
    style: "fantasy",
    rarity: "SR",
    category: "fantasy",
    character: "mage",
    color: "purple",
    price: "52.00",
    metadata: { seed: true },
  },
  {
    title: "Mecha Dragon Card",
    description: "机甲巨龙",
    imageUrl: "https://placehold.co/600x800/png",
    tags: ["机甲", "巨龙"],
    style: "mecha",
    rarity: "SSR",
    category: "mecha",
    character: "dragon",
    color: "steel",
    price: "61.00",
    metadata: { seed: true },
  },
  {
    title: "Shadow Assassin Card",
    description: "暗影刺客",
    imageUrl: "https://placehold.co/600x800/png",
    tags: ["暗影", "刺客"],
    style: "dark",
    rarity: "SR",
    category: "assassin",
    character: "female",
    color: "black",
    price: "47.50",
    metadata: { seed: true },
  },
  {
    title: "Celestial Guardian Card",
    description: "天界守护者",
    imageUrl: "https://placehold.co/600x800/png",
    tags: ["守护", "天界"],
    style: "celestial",
    rarity: "SSR",
    category: "fantasy",
    character: "guardian",
    color: "blue",
    price: "56.25",
    metadata: { seed: true },
  },
  {
    title: "Retro Pixel Hero Card",
    description: "像素英雄",
    imageUrl: "https://placehold.co/600x800/png",
    tags: ["像素", "复古"],
    style: "retro",
    rarity: "R",
    category: "retro",
    character: "hero",
    color: "pixel",
    price: "29.99",
    metadata: { seed: true },
  },
  {
    title: "Crimson Valkyrie Card",
    description: "猩红女武神",
    imageUrl: "https://placehold.co/600x800/png",
    tags: ["女角色", "战士"],
    style: "fantasy",
    rarity: "SSR",
    category: "warrior",
    character: "female",
    color: "red",
    price: "48.75",
    metadata: { seed: true },
  }
];

const extraCards = Array.from({ length: 10 }).map((_, index) => ({
  title: `Black Gold SSR Variant ${index + 1}`,
  description: "黑金SSR变体",
  imageUrl: "https://placehold.co/600x800/png",
  tags: ["黑金", "SSR"],
  style: "black gold",
  rarity: "SSR",
  category: "anime",
  character: "female",
  color: "black gold",
  price: "49.99",
  metadata: { seed: true },
}));

const seed = async (): Promise<void> => {
  const data = [...cards, ...extraCards];

  await prisma.galleryCard.createMany({
    data: data.map((card) => ({
      ...card,
      isActive: true,
    })),
  });

  await prisma.$disconnect();
  console.log(`Seeded ${data.length} gallery cards.`);
};

seed().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
