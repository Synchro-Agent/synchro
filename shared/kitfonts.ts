// Tệp sinh bởi tools/fetch-kit-fonts.mjs, không sửa tay: danh sách tệp phông của bộ Synchro tự phục vụ
// (public/kitfonts/v1/<id>/), mã băm sha256 đã ghim và phần css2 của Google Fonts (đường dự phòng khi trang không có
// địa chỉ Synchro). Kiểm thử: tests/api/kitfonts.test.mjs; node tools/fetch-kit-fonts.mjs --check để đối chiếu.
export const KIT_FONT_DIR = "/kitfonts/v1";
export const KIT_FONT_BYTES = 1879388;
export const KIT_FONT_CSS2 = {
  "be-vietnam-pro": "Be+Vietnam+Pro:wght@300;400;500;600;700;800",
  "inter": "Inter:wght@100..900",
  "plus-jakarta-sans": "Plus+Jakarta+Sans:wght@200..800",
  "montserrat": "Montserrat:wght@100..900",
  "ibm-plex-sans": "IBM+Plex+Sans:wght@100..700",
  "archivo": "Archivo:wght@100..900",
  "bricolage-grotesque": "Bricolage+Grotesque:wght@200..800",
  "space-grotesk": "Space+Grotesk:wght@300..700",
  "lexend": "Lexend:wght@100..900",
  "unbounded": "Unbounded:wght@200..900",
  "oswald": "Oswald:wght@200..700",
  "anton": "Anton",
  "playfair-display": "Playfair+Display:ital,wght@0,400..900;1,400..900",
  "fraunces": "Fraunces:ital,wght@0,100..900;1,100..900",
  "source-serif-4": "Source+Serif+4:ital,wght@0,200..900;1,200..900",
  "cormorant-garamond": "Cormorant+Garamond:ital,wght@0,300..700;1,300..700",
  "jetbrains-mono": "JetBrains+Mono:wght@100..800"
} as const;
export type KitFontFile = {
  file: string; subset: string; style: string; weight: string; bytes: number; sha256: string;
};
export const KIT_FONT_FILES = {
  "be-vietnam-pro": [
    {
      "file": "normal-300-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "300",
      "bytes": 5092,
      "sha256": "36e0cd62fe6705b2ed9c1976bf3d630d23bf4402f1522290f05906579afd65eb"
    },
    {
      "file": "normal-300-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "300",
      "bytes": 7160,
      "sha256": "3e217c40eb3f30f8378acc06b87fd0010cf192188ec63e3449a0d08130400c6c"
    },
    {
      "file": "normal-300-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "300",
      "bytes": 13604,
      "sha256": "36755b3a55aba6d45df37ba297d7996668e4de5ba3cceddfe2b0345c981f5533"
    },
    {
      "file": "normal-400-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "400",
      "bytes": 4720,
      "sha256": "b0d9b8aec7f47207ce4065be34286203e0741c8329be6d05986b149f991f84c1"
    },
    {
      "file": "normal-400-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "400",
      "bytes": 6880,
      "sha256": "c2ae124f149371e1b6209cbba234852310caeee3c32990a56ccb93ac1c7edb9a"
    },
    {
      "file": "normal-400-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "400",
      "bytes": 12908,
      "sha256": "d25f70ff7404fddbeb150c9c687bf37069468a5cdf59117b2a30226d1ebfa5c0"
    },
    {
      "file": "normal-500-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "500",
      "bytes": 5100,
      "sha256": "e83829fe40a88cff1c6ee213801661468bfed922771d1c382b4c1fdc269a5648"
    },
    {
      "file": "normal-500-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "500",
      "bytes": 7184,
      "sha256": "83b86791eb0ebfca23daa3f70ee179f13638c69441b69a6d2deb6b96a95385ea"
    },
    {
      "file": "normal-500-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "500",
      "bytes": 13324,
      "sha256": "0336df67f25be86ea38a6f37b11ffb4901c1ed65ce06ba99d6a304913e997e52"
    },
    {
      "file": "normal-600-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "600",
      "bytes": 5124,
      "sha256": "843908240371827470dd178e284ffbbeb85f1563bf47e5b9c9db58526fb7f6e0"
    },
    {
      "file": "normal-600-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "600",
      "bytes": 7152,
      "sha256": "90c10a1f4fdd8aa634b70bfc22ca991f12bba15b1661ea2390443e31888e1f5b"
    },
    {
      "file": "normal-600-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "600",
      "bytes": 13428,
      "sha256": "14950d0af319bbc1f7a26ed08bf1ba7a9e18324111056bb0c81eef0983a931c0"
    },
    {
      "file": "normal-700-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "700",
      "bytes": 5132,
      "sha256": "141f6c45010274d7d3625d0554476ec1161274d9eb09a38135977ea1b2b84895"
    },
    {
      "file": "normal-700-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "700",
      "bytes": 7164,
      "sha256": "f446d28e986c5695283afcb13a7719dabd9f2cec28ab49ecb43a328efa009f05"
    },
    {
      "file": "normal-700-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "700",
      "bytes": 13348,
      "sha256": "cf841d2b615f068e77a918114f44c17d51d0b73314fdff81eae95f528387c391"
    },
    {
      "file": "normal-800-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "800",
      "bytes": 5144,
      "sha256": "58a2faf88435a23f137b8221310009fca88a5a8e828a7626561168ac94913de1"
    },
    {
      "file": "normal-800-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "800",
      "bytes": 7144,
      "sha256": "c7266fff4717df8e9c25398fd6c37fa3ad385bead8f505bf00105c54524c6712"
    },
    {
      "file": "normal-800-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "800",
      "bytes": 13380,
      "sha256": "8a5b5841729c2ed690748ab243602bd45205575a5f58fe0c1fef04d79a912276"
    }
  ],
  "inter": [
    {
      "file": "normal-100-900-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "100 900",
      "bytes": 10280,
      "sha256": "8db00ff46c67b22cda8bed865acf7077651cac8d2841d5b40980556b48961931"
    },
    {
      "file": "normal-100-900-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "100 900",
      "bytes": 85272,
      "sha256": "a28eb6d3ccb534ae0c94ca999371df024aab60b08c3c8a5720ee9e32fa0faaa2"
    },
    {
      "file": "normal-100-900-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "100 900",
      "bytes": 48432,
      "sha256": "c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4"
    }
  ],
  "plus-jakarta-sans": [
    {
      "file": "normal-200-800-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "200 800",
      "bytes": 8292,
      "sha256": "5c913fc1b1f86f4b475e5df45a796aa480d1f7f0891ed6f1a5991d6d1be887c3"
    },
    {
      "file": "normal-200-800-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "200 800",
      "bytes": 21688,
      "sha256": "0303e02b53b0298fb26a0193941a2e8754f0f9a9fce50d90b178d8da3424873f"
    },
    {
      "file": "normal-200-800-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "200 800",
      "bytes": 27272,
      "sha256": "cd8db90cd950e26bc8761f65d323588bd5cd112d326d6d322bc7c8ea86771215"
    }
  ],
  "montserrat": [
    {
      "file": "normal-100-900-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "100 900",
      "bytes": 10620,
      "sha256": "9e2672d100bc36a37073fb250abfaa7394f5151bf5dda3f4d5fc281345eb391b"
    },
    {
      "file": "normal-100-900-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "100 900",
      "bytes": 68224,
      "sha256": "920711de9ae96c18970fa4faca73cd302b93ac5ed57ebeb6bfec2ddeff930082"
    },
    {
      "file": "normal-100-900-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "100 900",
      "bytes": 35508,
      "sha256": "6438d7b8ea9c7c3992d5e2fd2afdb1ff948570a3ef0bedae76247b51632960ba"
    }
  ],
  "ibm-plex-sans": [
    {
      "file": "normal-100-700-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "100 700",
      "bytes": 9612,
      "sha256": "526a4dd36c3af41f73a623e852302d8947d7fd4c00ee3026d82ef1f24a412fcd"
    },
    {
      "file": "normal-100-700-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "100 700",
      "bytes": 25868,
      "sha256": "ae1d854fefa1167a79071f1afe01d4d51b60c5840c1be36dd74bd5fe7375b405"
    },
    {
      "file": "normal-100-700-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "100 700",
      "bytes": 40240,
      "sha256": "056e4e2459f57a0033c8c9c844ff19d6e42ac8602027803d4345823bcc939818"
    }
  ],
  "archivo": [
    {
      "file": "normal-100-900-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "100 900",
      "bytes": 13216,
      "sha256": "2518e8eb97cd2b36dbf380d085e47bbc0df5c32fc6adc32fe1ca6edce192cee0"
    },
    {
      "file": "normal-100-900-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "100 900",
      "bytes": 32672,
      "sha256": "a999e009fdcd0f939c138e04043b3b2ad083b26252b644e8f94c083d48b77af0"
    },
    {
      "file": "normal-100-900-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "100 900",
      "bytes": 34940,
      "sha256": "7150c0ec5ad356453013d11affec1fbab95de0dd2dcecb043b4f1cb7f87c4ba4"
    }
  ],
  "bricolage-grotesque": [
    {
      "file": "normal-200-800-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "200 800",
      "bytes": 8652,
      "sha256": "ea16948d4a91b77221f119ad27d4ac7a7581c98cf990712047f89a531a49ef28"
    },
    {
      "file": "normal-200-800-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "200 800",
      "bytes": 18740,
      "sha256": "a22c997a894377f36d81c904163e0c05fbbcd32f0ca2e7beedb86b39be1296a1"
    },
    {
      "file": "normal-200-800-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "200 800",
      "bytes": 41236,
      "sha256": "4fd48b2c1ab27220e71f15f990550261b35245c3bdfd8d8025b4bdac0459ee2d"
    }
  ],
  "space-grotesk": [
    {
      "file": "normal-300-700-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "300 700",
      "bytes": 6772,
      "sha256": "d699664b145bfeeccc66a4cce7fa55e14eb63efd7ec6b0b2ec52e25dd98f3917"
    },
    {
      "file": "normal-300-700-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "300 700",
      "bytes": 18924,
      "sha256": "054c266fbb441ee059365dba0885d206f67ca05b375de869b88e02ebfccc9b9d"
    },
    {
      "file": "normal-300-700-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "300 700",
      "bytes": 22320,
      "sha256": "a0d054c4af557de20afd6ca59f47ab353bcaec49c63ff04b6c9d39d0f8910557"
    }
  ],
  "lexend": [
    {
      "file": "normal-100-900-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "100 900",
      "bytes": 13668,
      "sha256": "618f4e337fba7164fd9aa298629d2b9aeaf1b9cb71081d504a05ea2a74a7f79f"
    },
    {
      "file": "normal-100-900-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "100 900",
      "bytes": 34548,
      "sha256": "368c86e96b024720e4a7910af4bc4447d8b5f011bbb894c357dc02c3ca282d89"
    },
    {
      "file": "normal-100-900-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "100 900",
      "bytes": 39692,
      "sha256": "1ec8f6ee2750554b4bc59ff0b507d316a82a7ba37e0e5bebc41d3bd9b9faad46"
    }
  ],
  "unbounded": [
    {
      "file": "normal-200-900-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "200 900",
      "bytes": 13856,
      "sha256": "54a956ea5b2cfddfea2d336dd36bfcba64f40fa8b2d41685d9d4edf4a2910ab8"
    },
    {
      "file": "normal-200-900-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "200 900",
      "bytes": 117648,
      "sha256": "ed84482df7b95e6a56a113de1ba2a8d54337f499ba19d54ca697a7e15427ff5f"
    },
    {
      "file": "normal-200-900-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "200 900",
      "bytes": 50892,
      "sha256": "d7f07f8a308ce0a7287d79a65a85cfbc0f4741ef426bf1a3902d24392cc71723"
    }
  ],
  "oswald": [
    {
      "file": "normal-200-700-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "200 700",
      "bytes": 7540,
      "sha256": "c47ce12d6be343e0f08aa8d6db815ce04566fc98cc0952802565251b1419cdff"
    },
    {
      "file": "normal-200-700-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "200 700",
      "bytes": 24048,
      "sha256": "387bb9ea916076d47014c0db1c750b482547647f2ab9ad73ae585928377d12fa"
    },
    {
      "file": "normal-200-700-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "200 700",
      "bytes": 28456,
      "sha256": "c36937da4c39049704f1def587f7837a24ad52d3bfd2d27d3b6eb9f4220b2e3a"
    }
  ],
  "anton": [
    {
      "file": "normal-400-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "400",
      "bytes": 5188,
      "sha256": "889f979804fc6c2ddb3c9577805caf156bfd092a5b6e58d680535d65267b933e"
    },
    {
      "file": "normal-400-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "400",
      "bytes": 21296,
      "sha256": "ae1a8ac1c2899a66eed47a851201bb78a56664bf8da6d34a9ee226582d15ac19"
    },
    {
      "file": "normal-400-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "400",
      "bytes": 12004,
      "sha256": "23aab0b2692a0c89eb7997d3c7cf5bda41276d6cd4ab6cc0edc3edfcece32b09"
    }
  ],
  "playfair-display": [
    {
      "file": "italic-400-900-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "italic",
      "weight": "400 900",
      "bytes": 9548,
      "sha256": "35a2bab58d032302776e37f54b9ce932bb07fa3139751053a374ba54f1b494f9"
    },
    {
      "file": "italic-400-900-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "italic",
      "weight": "400 900",
      "bytes": 23332,
      "sha256": "4d6a56168573c731f483ecfbaa468d38a674be49335160476bfa1eaf7c399fbb"
    },
    {
      "file": "italic-400-900-latin.woff2",
      "subset": "latin",
      "style": "italic",
      "weight": "400 900",
      "bytes": 38888,
      "sha256": "c68530044e7c4ce6cd3c1c239d0a93be71af53821574714f83e1380d8b393d14"
    },
    {
      "file": "normal-400-900-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "400 900",
      "bytes": 9056,
      "sha256": "8fa67d5f0ab2a1d0b924729a0411a069b384d7a236edd96a6767ef342a6d048f"
    },
    {
      "file": "normal-400-900-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "400 900",
      "bytes": 20980,
      "sha256": "5628567856d60d714e7a35bcac9e3de08b336d63b12138f61b970990a1ee9547"
    },
    {
      "file": "normal-400-900-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "400 900",
      "bytes": 38460,
      "sha256": "5d91eb5d522a03081946c44c8ca17c902230dfed5f0f9b5014262135d47b15b2"
    }
  ],
  "fraunces": [
    {
      "file": "italic-100-900-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "italic",
      "weight": "100 900",
      "bytes": 12956,
      "sha256": "d24c3502a91415f2ec44f107807673255b696c379b3995543270921c27863e32"
    },
    {
      "file": "italic-100-900-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "italic",
      "weight": "100 900",
      "bytes": 40560,
      "sha256": "7e701dc124492f7d0856fba4a07157d0cecc84e2b2b4615f08530c1e8bc112dd"
    },
    {
      "file": "italic-100-900-latin.woff2",
      "subset": "latin",
      "style": "italic",
      "weight": "100 900",
      "bytes": 45624,
      "sha256": "c9745ee907c02cdd46cc41a65bb711cd861432f679a76c18e3de204a18723040"
    },
    {
      "file": "normal-100-900-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "100 900",
      "bytes": 11536,
      "sha256": "250cc2966c658fb6d336731de9d82a8129025e9839c20c253bbc477852f6cf4f"
    },
    {
      "file": "normal-100-900-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "100 900",
      "bytes": 33640,
      "sha256": "f1451edd6434085c4f9f3a8b4a674182dd7d6acccf53bfced19fd167f0705a06"
    },
    {
      "file": "normal-100-900-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "100 900",
      "bytes": 36560,
      "sha256": "88e17be075f1be50ab67b057b99e3701b828f44ed28f9452df6c02645bb0cba9"
    }
  ],
  "source-serif-4": [
    {
      "file": "italic-200-900-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "italic",
      "weight": "200 900",
      "bytes": 13940,
      "sha256": "25f97f6bfa24dac3c3680d072a529e22d3f0ffd6b1767c87c65bb821889d8796"
    },
    {
      "file": "italic-200-900-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "italic",
      "weight": "200 900",
      "bytes": 44356,
      "sha256": "fa851a3159c26f5c3eebbeb0c247d6499168feef25aec7d31e7c33195d26c83a"
    },
    {
      "file": "italic-200-900-latin.woff2",
      "subset": "latin",
      "style": "italic",
      "weight": "200 900",
      "bytes": 51720,
      "sha256": "4dbf6638832394945c054a76dee4f9ced221d1c52a4ce6a29ecc4195232f966b"
    },
    {
      "file": "normal-200-900-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "200 900",
      "bytes": 13400,
      "sha256": "752875b4c33f07a3dda7c8f0be846fef059cb0f4e85211b855aa93dd85d45a22"
    },
    {
      "file": "normal-200-900-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "200 900",
      "bytes": 42040,
      "sha256": "231f594ad829d45f905a8a6cdce704f659615e00f1a9db2699320e6e315c1d1f"
    },
    {
      "file": "normal-200-900-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "200 900",
      "bytes": 50952,
      "sha256": "8e38e3fbd74dea20aabe0831ffef04c9f30bf6fc5b99b7a2649be0dd8c6d859c"
    }
  ],
  "cormorant-garamond": [
    {
      "file": "italic-300-700-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "italic",
      "weight": "300 700",
      "bytes": 11556,
      "sha256": "3512ad3b4ddd21fa75ab44296867da1f82948350ffba678a04afbb511015cb08"
    },
    {
      "file": "italic-300-700-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "italic",
      "weight": "300 700",
      "bytes": 34444,
      "sha256": "06bc9a8c179afaf7dd5d3b4987ad2f4a82ca85a542c9e498b18bf32ad0257d8e"
    },
    {
      "file": "italic-300-700-latin.woff2",
      "subset": "latin",
      "style": "italic",
      "weight": "300 700",
      "bytes": 39304,
      "sha256": "e6d6d1d73858aa9b66f3a3539f9dec22faab2276e61ad1d813bc04dd59c9c122"
    },
    {
      "file": "normal-300-700-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "300 700",
      "bytes": 11264,
      "sha256": "826f73ca737feec0eb1004808629973d6b611fddc2bd2a689b5fe331f6be6427"
    },
    {
      "file": "normal-300-700-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "300 700",
      "bytes": 33740,
      "sha256": "9dc38267bdee93a653200ef3c1e8060e3f1399073432c415c683b419d3b50464"
    },
    {
      "file": "normal-300-700-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "300 700",
      "bytes": 37776,
      "sha256": "5d618c462b7a5b74f442e1548880086af71764d9cc7d35c16ab45353da934621"
    }
  ],
  "jetbrains-mono": [
    {
      "file": "normal-100-800-vietnamese.woff2",
      "subset": "vietnamese",
      "style": "normal",
      "weight": "100 800",
      "bytes": 7468,
      "sha256": "1390e86cc2823e759358918c01c4fcc1b6e4f01bca915bdbeb6d68eb5c244405"
    },
    {
      "file": "normal-100-800-latin-ext.woff2",
      "subset": "latin-ext",
      "style": "normal",
      "weight": "100 800",
      "bytes": 15204,
      "sha256": "7db7affbce1fdee69c1ffc2641bbca289b049867f524c9d861fe35ab6670bf29"
    },
    {
      "file": "normal-100-800-latin.woff2",
      "subset": "latin",
      "style": "normal",
      "weight": "100 800",
      "bytes": 40480,
      "sha256": "1e06740a02a443fb7f3eeda8fcaa685a0f6c620e3f01e6666e847295469ce3ad"
    }
  ]
} as const;
/** Địa chỉ face.css của một phông trong bộ (origin rỗng: đường dẫn tương đối của chính Synchro). */
export const kitFaceUrl = (origin: string, id: string) => `${origin}${KIT_FONT_DIR}/${id}/face.css`;
