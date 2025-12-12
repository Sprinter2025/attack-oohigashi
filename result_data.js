// result_data.js
// 結果画面用：スコア帯ごとの画像＆コメント（コメントはランダム選択）
//
// 仕様：
// - 0~100, 101~200, 201~300, 301~400, 401~500, 501~
// - 各帯に img 1枚 + comments 複数
// - img は assets/ 以下を想定（好きに変えてOK）

window.RESULT_PACKS = [
  {
    min: 0, max: 100,
    img: "./assets/result/0-100.png",
    comments: [
      "まずは肩慣らし！次はコンボ狙いだ。",
      "落ち着いて当てていこう。",
      "ここから伸びるやつ！"
    ],
  },
  {
    min: 101, max: 200,
    img: "./assets/result/101-200.png",
    comments: [
      "いい感じ！精度が上がってきた。",
      "コンボ維持ができてる！",
      "その調子、その調子。"
    ],
  },
  {
    min: 201, max: 300,
    img: "./assets/result/201-300.png",
    comments: [
      "強い。反射神経が仕上がってる。",
      "FEVERを回せてるね！",
      "もう一段上いける！"
    ],
  },
  {
    min: 301, max: 400,
    img: "./assets/result/301-400.png",
    comments: [
      "上級者。指が速い。",
      "コンボ職人きた。",
      "安定感がえぐい。"
    ],
  },
  {
    min: 401, max: 500,
    img: "./assets/result/401-500.png",
    comments: [
      "神の領域一歩手前。",
      "ミスが少なすぎる！",
      "手元どうなってるの？"
    ],
  },
  {
    min: 501, max: null, // null = 上限なし（501~）
    img: "./assets/result/501plus.png",
    comments: [
      "バケモン。優勝。",
      "世界記録狙える。",
      "指のGPU載ってる？"
    ],
  },
];
