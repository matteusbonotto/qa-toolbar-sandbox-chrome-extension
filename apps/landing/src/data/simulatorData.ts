export interface SimEnvironment {
  id: string;
  name: string;
  color: string;
  url: string;
}

interface WhiteLabelEntity {
  id: string;
  name: string;
  abbreviation?: string;
  showLabel?: boolean;
}

export interface SimProduct extends WhiteLabelEntity {
  environments: SimEnvironment[];
}

export interface SimProject extends WhiteLabelEntity {
  products: SimProduct[];
}

export interface SimClient extends WhiteLabelEntity {
  projects: SimProject[];
}

export const simulatorWorkspace: SimClient[] = [
  {
    id: "loja-fictus",
    name: "Loja Fictus",
    abbreviation: "LF",
    showLabel: true,
    projects: [
      {
        id: "checkout",
        name: "Checkout",
        abbreviation: "CHK",
        showLabel: true,
        products: [
          {
            id: "web",
            name: "Web",
            showLabel: true,
            environments: [
              { id: "dev", name: "Dev", color: "#7c5cff", url: "dev.lojafictus.com/checkout" },
              { id: "qa", name: "QA", color: "#33d6b0", url: "qa.lojafictus.com/checkout" },
              { id: "staging", name: "Staging", color: "#ffb454", url: "staging.lojafictus.com/checkout" },
              { id: "prod", name: "Produção", color: "#ff6b6b", url: "lojafictus.com/checkout" },
            ],
          },
          {
            id: "mobile",
            name: "Mobile",
            abbreviation: "MOB",
            showLabel: false,
            environments: [
              { id: "dev", name: "Dev", color: "#7c5cff", url: "dev.lojafictus.com/app/checkout" },
              { id: "qa", name: "QA", color: "#33d6b0", url: "qa.lojafictus.com/app/checkout" },
            ],
          },
        ],
      },
      {
        id: "catalogo",
        name: "Catálogo",
        showLabel: true,
        products: [
          {
            id: "web",
            name: "Web",
            showLabel: true,
            environments: [
              { id: "dev", name: "Dev", color: "#7c5cff", url: "dev.lojafictus.com/catalogo" },
              { id: "prod", name: "Produção", color: "#ff6b6b", url: "lojafictus.com/catalogo" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "banco-exemplo",
    name: "Banco Exemplo",
    abbreviation: "BE",
    showLabel: true,
    projects: [
      {
        id: "internet-banking",
        name: "Internet Banking",
        abbreviation: "IB",
        showLabel: false,
        products: [
          {
            id: "web",
            name: "Web",
            showLabel: true,
            environments: [
              { id: "homolog", name: "Homolog", color: "#33d6b0", url: "homolog.bancoexemplo.com.br" },
              { id: "prod", name: "Produção", color: "#ff6b6b", url: "bancoexemplo.com.br" },
            ],
          },
        ],
      },
    ],
  },
];
