import { type CategoryIconKey, isCategoryIconKey } from './art';

/**
 * Which drawing a category's name asks for, the first rule that fits winning: the more particular
 * words stand above the general ones («Цонхтой чихэр, печень» is a box, «Иштэй чихэр» a lollipop,
 * «Элсэн чихэр, Давс» salt). A word fits from a word's start, so «мах» also reads «махан»; a word
 * ending in a space fits only whole («сүү » is not «сүүн»).
 */
const RULES: readonly (readonly [CategoryIconKey, readonly string[]])[] = [
  ['uncategorized', ['ангилаагүй']],
  // The top groups, whose names hold words of what is below them.
  ['wheat', ['гурил будаа']],
  ['teaCoffee', ['цай кофе', 'кофе цай']],
  ['condiment', ['амтлагч соус']],
  ['household', ['гэр ахуй']],
  ['condensed', ['молоко', 'сгущ']],
  ['jam', ['чанамал', 'варень']],
  ['register', ['касс']],
  ['packing', ['савалгааны']],
  ['pieces', ['ширхэг']],
  ['assorted', ['төрөл бүрийн']],
  // Smoke.
  ['vape', ['электрон тамхи', 'вейп']],
  ['cigarette', ['тамхи', 'сигар']],
  // Children.
  ['babyFood', ['нэмэлт хоол', 'хүүхдийн хоол']],
  ['kidsGift', ['хүүхдийн бэлэг']],
  ['diaper', ['памперс', 'живх']],
  ['toy', ['тоглоом']],
  ['puree', ['нухаш', 'пюре']],
  ['baby', ['хүүхд']],
  // Drinks.
  ['energy', ['энергийн', 'вакус']],
  ['soda', ['хийжүүлсэн', 'газтай', 'кола']],
  ['tetra', ['тетра']],
  ['juice', ['жүүс', 'шүүс', 'сок']],
  ['wine', ['дарс', 'виски', 'коньяк']],
  ['vodka', ['архи']],
  ['beer', ['пиво', 'шар айраг']],
  ['water', ['цэвэр ус', 'рашаан', 'ус ']],
  ['drinks', ['шингэн бүтээгдэхүүн', 'ундаа']],
  // Sweets.
  ['salt', ['элсэн чихэр', 'давс']],
  ['sugarCube', ['сахар', 'ёотон']],
  ['candyBox', ['цонхтой', 'хайрцагтай']],
  ['lollipop', ['иштэй']],
  ['candyBag', ['ууттай']],
  ['gummy', ['резен', 'мармелад']],
  ['candy', ['савалгаатай', 'чихэр']],
  ['nuts', ['самар', 'үрэл']],
  ['gum', ['бохь', 'гаа ']],
  ['wafer', ['вафли']],
  ['chocolate', ['шоколад']],
  ['giftBox', ['набор', 'бэлэг']],
  ['swissRoll', ['рулет', 'чокопай']],
  ['cake', ['торт', 'кекс', 'бялуу']],
  ['cookie', ['печень', 'жигнэмэг']],
  ['chips', ['чипс', 'сумо']],
  ['sweets', ['амттан']],
  // Food.
  ['readyMeal', ['бэлэн хоол']],
  ['iceCream', ['зайрмаг']],
  ['croissant', ['бэйкери', 'круассан']],
  ['bread', ['талх', 'боов']],
  ['can', ['лаазалсан', 'лааз']],
  ['ger', ['нутгийн', 'монгол']],
  ['sausage', ['хиам', 'зайдас', 'царцаамаг']],
  ['egg', ['өндөг']],
  ['jerky', ['хатаасан', 'борц']],
  ['chicken', ['тахиа', 'гахай']],
  ['dumpling', ['бууз', 'банш']],
  ['meat', ['мах']],
  // Hot drinks and dairy.
  ['coffee', ['кофе']],
  ['tea', ['цай']],
  ['yogurt', ['иогурт']],
  ['tarag', ['тараг']],
  ['cheese', ['сыр', 'бяслаг']],
  ['butter', ['масло', 'цөцгийн тос']],
  ['dairy', ['сүүн']],
  ['milk', ['сүү ']],
  // Seasonings.
  ['spice', ['амтлагч']],
  ['mayo', ['майонез']],
  ['pickles', ['огурцы', 'лечо', 'салат', 'даршилсан']],
  ['oil', ['ургамлын тос', 'ургамалын тос', 'тос ']],
  ['ketchup', ['кетчуп', 'соус', 'цуу ']],
  ['honey', ['зөгийн бал', 'бал ']],
  ['compote', ['компот']],
  // Grain.
  ['rice', ['будаа']],
  ['flour', ['гурил']],
  ['noodles', ['гоймон', 'лапша']],
  ['seaweed', ['пүнтүүз', 'далайн байцаа']],
  // Care and the home.
  ['feminine', ['эмэгтэйчүүд']],
  ['cleaner', ['ахуйн шингэн', 'цэвэрлэгч']],
  ['laundrySoap', ['эдийн саван']],
  ['soap', ['саван']],
  ['detergent', ['вок ', 'угаалгын']],
  ['shoeCare', ['гутал']],
  ['toiletPaper', ['нойлын', 'ариун цэврийн цаас']],
  ['tissue', ['сальфетка', 'салфетка', 'алчуур цаас']],
  ['shampoo', ['шанпунь', 'шампунь', 'ангижруулагч']],
  ['toothpaste', ['шүдний', 'сойз']],
  ['cosmetics', ['гоо сайхан', 'будалт']],
  ['homeGoods', ['ахуйн']],
  // Everything else on the shelves.
  ['gloves', ['бээлий']],
  ['slippers', ['таавчик', 'шаахай', 'алчуур']],
  ['electric', ['цахилгаан']],
  ['bagsTape', ['уут баглаа', 'скоч']],
  ['china', ['хятад']],
  ['japan', ['япон']],
  ['stationery', ['бичиг хэрэг', 'дэвтэр']],
];

/** Lower case with the words apart, a space on either side. */
function wordsOf(name: string): string {
  return ` ${name
    .toLowerCase()
    .replace(/[^0-9a-zа-яёөү]+/g, ' ')
    .trim()} `;
}

/** The drawing a category's name asks for; `bag` when none of its words is known. */
export function suggestCategoryIcon(name: string): CategoryIconKey {
  const words = wordsOf(name);
  for (const [key, keywords] of RULES) {
    if (keywords.some((word) => words.includes(` ${word}`))) return key;
  }
  return 'bag';
}

/** A category's drawing: the one chosen for it (an unknown key ignored), else what its name asks for. */
export function categoryIconOf(category: {
  iconKey: string | null;
  name: string;
}): CategoryIconKey {
  return category.iconKey !== null && isCategoryIconKey(category.iconKey)
    ? category.iconKey
    : suggestCategoryIcon(category.name);
}
