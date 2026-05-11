import { SupportedLanguage } from "../hermes/types";

const dictionary: Record<SupportedLanguage, Record<string, string>> = {
  zh: {
    "channel.onlyLootcardchoose": "请到 #lootcardchoose 频道使用图库选卡功能。",
    "gallery.search.success": "✅ 为你找到 {count} 张卡牌样式",
    "gallery.search.empty": "没有找到匹配的卡牌，请换一个描述试试。",
    "gallery.search.chooseHint": "回复编号 1-{count} 选择。",
    "gallery.search.resultTitle": "第 {index} 张：{title}",
    "gallery.search.resultPrice": "价格：{price}",
    "gallery.search.resultTags": "标签：{tags}",
    "gallery.select.invalid": "请选择有效编号（1-10）。",
    "gallery.select.success": "已为你选择第 {index} 张卡牌。",
    "gallery.select.confirmNext": "如果你确认这张卡牌，我们下一步再生成付款链接。",
    "checkout.creating": "正在生成付款链接，请稍候。",
    "checkout.success": "付款链接已生成。",
    "checkout.failed": "暂时无法生成付款链接，请稍后再试。",
    "order.status.notFound": "暂时没有找到订单记录。",
    "order.status.current": "当前订单状态：{status}",
    "help.message": "输入示例：给我10张黑金SSR女角色卡牌。然后回复 1-10 进行选择。",
    "error.generic": "系统处理中出错，请稍后再试。",
    "gallery.description.empty": "暂无描述",
  },
  en: {
    "channel.onlyLootcardchoose": "Please use the #lootcardchoose channel for gallery card selection.",
    "gallery.search.success": "✅ Found {count} card styles for you",
    "gallery.search.empty": "No matching cards found. Try a different description.",
    "gallery.search.chooseHint": "Reply with a number from 1-{count} to choose.",
    "gallery.search.resultTitle": "Card {index}: {title}",
    "gallery.search.resultPrice": "Price: {price}",
    "gallery.search.resultTags": "Tags: {tags}",
    "gallery.select.invalid": "Please choose a valid number (1-10).",
    "gallery.select.success": "Selected card #{index} for you.",
    "gallery.select.confirmNext": "If this is the one you want, we can generate the checkout link next.",
    "checkout.creating": "Creating your checkout link. Please wait.",
    "checkout.success": "Your checkout link is ready.",
    "checkout.failed": "Unable to create a checkout link right now. Please try again later.",
    "order.status.notFound": "No order record was found yet.",
    "order.status.current": "Current order status: {status}",
    "help.message": "Example: Show me 10 black gold SSR female character cards. Then reply with a number from 1-10.",
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
