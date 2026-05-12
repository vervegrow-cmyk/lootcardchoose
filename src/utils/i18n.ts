import { SupportedLanguage } from "../hermes/types";

const dictionary: Record<SupportedLanguage, Record<string, string>> = {
  zh: {
    "channel.onlyLootcardchoose": "请到 #lootcardchoose 频道使用图库选卡功能。",
    "gallery.search.success": "我为你找到 {count} 张卡牌。",
    "gallery.search.empty": "抱歉，暂时没有找到符合要求的卡牌。",
    "gallery.search.chooseHint": "请回复 1-{count} 的编号进行选择。",
    "gallery.search.resultTitle": "第 {index} 张：{title}",
    "gallery.search.resultPrice": "价格：${price}",
    "gallery.search.resultTags": "标签：{tags}",
    "gallery.select.invalid": "请选择有效编号（1-10）。",
    "gallery.select.success": "你已选择这张卡牌。",
    "gallery.select.confirmNext": "我正在为你创建 Shopify 商品链接。",
    "checkout.creating": "正在创建商品链接，请稍候。",
    "checkout.success": "商品链接已生成。",
    "checkout.failed": "暂时无法创建商品链接，请稍后再试。",
    "order.status.notFound": "暂时没有找到订单记录。",
    "order.status.current": "当前订单状态：{status}",
    "help.message": "你可以告诉我想要的颜色、稀有度、角色类型或风格，我会帮你找到合适的卡牌。",
    "error.generic": "系统处理时出现问题，请稍后再试。",
    "gallery.description.empty": "暂无描述",
  },
  en: {
    "channel.onlyLootcardchoose": "Please use the #lootcardchoose channel for gallery card selection.",
    "gallery.search.success": "I found {count} cards for you.",
    "gallery.search.empty": "Sorry, I couldn't find matching cards.",
    "gallery.search.chooseHint": "Reply with a number from 1-{count} to choose one.",
    "gallery.search.resultTitle": "Card {index}: {title}",
    "gallery.search.resultPrice": "Price: ${price}",
    "gallery.search.resultTags": "Tags: {tags}",
    "gallery.select.invalid": "Please choose a valid number (1-10).",
    "gallery.select.success": "You selected this card.",
    "gallery.select.confirmNext": "I'm creating your Shopify product link now.",
    "checkout.creating": "Creating your product link. Please wait.",
    "checkout.success": "Your product link is ready.",
    "checkout.failed": "Unable to create a product link right now. Please try again later.",
    "order.status.notFound": "No order record was found yet.",
    "order.status.current": "Current order status: {status}",
    "help.message": "Tell me the style, color, rarity, or character type you want, and I can help you find the right card.",
    "error.generic": "Something went wrong while processing your request. Please try again later.",
    "gallery.description.empty": "No description available",
  },
};

export const t = (
  language: SupportedLanguage,
  key: string,
  params?: Record<string, string | number>
): string => {
  const template = dictionary[language][key];
  if (!template) {
    return key;
  }

  if (!params) {
    return template;
  }

  return Object.entries(params).reduce(
    (result, [paramKey, value]) => result.split(`{${paramKey}}`).join(String(value)),
    template
  );
};
