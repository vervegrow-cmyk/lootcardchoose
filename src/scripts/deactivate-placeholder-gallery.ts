import { loadEnv } from "../config/env";
import { prisma } from "../services/prisma.service";

type GalleryStats = {
  total: number;
  active: number;
  placeholder: number;
  activePlaceholder: number;
  activeR2: number;
};

const PLACEHOLDER_HOST = "placehold.co";

const collectStats = async (): Promise<GalleryStats> => {
  const env = loadEnv();
  const r2PublicUrl = env.r2PublicUrl.toLowerCase();
  const r2Filters = [{ imageUrl: { contains: "r2.dev", mode: "insensitive" as const } }];

  if (r2PublicUrl) {
    r2Filters.push({
      imageUrl: {
        contains: r2PublicUrl,
        mode: "insensitive" as const,
      },
    });
  }

  const [total, active, placeholder, activePlaceholder, activeR2] = await Promise.all([
    prisma.galleryCard.count(),
    prisma.galleryCard.count({ where: { isActive: true } }),
    prisma.galleryCard.count({
      where: {
        imageUrl: { contains: PLACEHOLDER_HOST, mode: "insensitive" },
      },
    }),
    prisma.galleryCard.count({
      where: {
        isActive: true,
        imageUrl: { contains: PLACEHOLDER_HOST, mode: "insensitive" },
      },
    }),
    prisma.galleryCard.count({
      where: {
        isActive: true,
        OR: r2Filters,
      },
    }),
  ]);

  return {
    total,
    active,
    placeholder,
    activePlaceholder,
    activeR2,
  };
};

const main = async (): Promise<void> => {
  const before = await collectStats();
  console.log("[GALLERY GOVERNANCE] before");
  console.log(JSON.stringify(before, null, 2));

  const updateResult = await prisma.galleryCard.updateMany({
    where: {
      isActive: true,
      imageUrl: { contains: PLACEHOLDER_HOST, mode: "insensitive" },
    },
    data: {
      isActive: false,
    },
  });

  const after = await collectStats();
  console.log("[GALLERY GOVERNANCE] affected count=" + updateResult.count);
  console.log("[GALLERY GOVERNANCE] after");
  console.log(JSON.stringify(after, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
