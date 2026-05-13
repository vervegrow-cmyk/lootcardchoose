import { SupportedLanguage } from "../hermes/types";

const dictionary: Record<SupportedLanguage, Record<string, string>> = {
  zh: {
    "channel.onlyLootcardchoose": "请到 #lootcardchoose 频道使用图库选卡功能。",
    "gallery.search.success": "我为你找到了 {count} 张卡牌。",
    "gallery.search.empty": "抱歉，暂时没有找到符合要求的卡牌。",
    "gallery.search.chooseHint": "请回复 1-{count} 的编号进行选择。",
    "gallery.search.resultTitle": "第 {index} 张：{title}",
    "gallery.search.resultPrice": "价格：{price}",
    "gallery.search.resultTags": "标签：{tags}",
    "gallery.select.invalid": "请选择有效编号（1-10）。",
    "gallery.select.success": "你已选择这张卡牌。",
    "gallery.select.confirmNext": "我正在为你创建 Shopify 商品链接。",
    "gallery.refresh.nextBatch": "这是为你换的一批卡牌，请回复编号选择一张。",
    "gallery.refresh.refine": "我为你换了一批更接近你偏好的卡牌，请回复编号选择一张。",
    "gallery.refresh.broaden": "最匹配的卡牌已经展示完了，我再给你推荐一些可能喜欢的。",
    "gallery.refresh.noPreviousSearch": "请先告诉我你想找什么类型的卡牌，我再帮你换一批。",
    "gallery.refresh.needClarification": "你想换成哪种风格：可爱、暗黑、幻想，还是高级感？",
    "checkout.creating": "正在创建商品链接，请稍候。",
    "checkout.success": "商品链接已生成。",
    "checkout.failed": "暂时无法创建商品链接，请稍后再试。",
    "order.status.notFound": "暂时没有找到订单记录。",
    "order.status.current": "当前订单状态：{status}",
    "help.message": "你可以告诉我想要的风格、颜色、稀有度或角色类型，我会帮你找到合适的卡牌。",
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
    "gallery.refresh.nextBatch": "Here’s another batch of cards for you. Reply with a number to select one.",
    "gallery.refresh.refine": "I found another set that better matches your style. Reply with a number to select one.",
    "gallery.refresh.broaden": "I’ve shown the closest matches, so I’m showing some related options you may like.",
    "gallery.refresh.noPreviousSearch": "Please search for a card style first, then I can show you another batch.",
    "gallery.refresh.needClarification": "What style would you like next - cute, dark, fantasy, or premium?",
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
  const template = dictionary[language][key] ?? dictionary.en[key];
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
