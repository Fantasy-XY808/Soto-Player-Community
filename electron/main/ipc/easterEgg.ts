import { ipcMain } from "electron";
import { showEasterEgg, closeEasterEgg, isEasterEggAvailable } from "@main/window/easterEgg";

/**
 * 彩蛋相关 IPC 处理
 *
 * 如果你知道了这个彩蛋，请一定不要告诉任何人🤫
 * If you know this easter egg, please do not tell anyone🤫
 * もしこのイースターエッグを知ったら、誰にも言わないでね🤫
 * Si vous connaissez cet easter egg, ne le dites à personne🤫
 * Si conoces este huevo de pascua, no se lo digas a nadie🤫
 * Wenn du dieses Easter Egg kennst, sag es niemandem🤫
 * Se conosci questo easter egg, non dirlo a nessuno🤫
 * Если вы знаете эту пасхалку, не говорите никому🤫
 * 이 이스터 에그를 알게 되면 아무에게도 말하지 마세요🤫
 * Si você souber deste easter egg, não conte a ninguém🤫
 * Если знаете этот easter egg, не говорите никому🤫
 * 如果你知道這個彩蛋，請一定不要告訴任何人🤫
 * 如果你知道呢个彩蛋，请一定唔好话俾任何人知🤫
 * Bu easter egg'i biliyorsan, lütfen kimseye söyleme🤫
 * اگر این تخم مرغ عید پاک را می‌دانید، لطفاً به کسی نگویید🤫
 * Jeśli znasz ten easter egg, nie mów o tym nikomu🤫
 * Als je deze paasei kent, vertel het dan aan niemand🤫
 * Om du känner till detta påskägg, berätta inte för någon🤫
 * このイースターエッグを知った場合は、絶対に誰にも言わないでください🤫
 * Nếu bạn biết easter egg này, xin đừng nói với ai🤫
 */
export const registerEasterEggIpc = (): void => {
  ipcMain.handle("easter-egg:show", () => {
    showEasterEgg();
  });
  ipcMain.handle("easter-egg:close", () => {
    closeEasterEgg();
  });
  ipcMain.handle("easter-egg:available", () => isEasterEggAvailable());
};
