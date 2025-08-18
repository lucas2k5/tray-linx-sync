import axios from 'axios';

export async function fetchStockFromLinx() {
  try {
    const response = await axios.post(
      'https://auto-gwsmartapi.linx.com.br/api-e-commerce-premium/ConsultaPecaGerencial',
      {
        ConfiguracaoBase: {
          Empresa: 1,
          Revenda: 1,
          Usuario: 0,
          CodigoOrigem: 0,
          IdentificadorOrigem: '',
          ClienteContactado: false
        },
        TextoPesquisa: "",
        CodigoItemParcial: "",
        CodigoEanGtin: "",
        DescricaoItemParcial: "",
        UtilizacaoItemParcial: "",
        GruposPecas: "",
        Marcas: "",
        ListaFornecedoresDSH: "",
        TipoPesquisa: "I",
        ClasseFabrica: "",
        TipoTransacao: "P21",
        RetiraPrecoMarkup: false,
        RecallFCA: false,
        DisponibilidadeCatalogo: false,
        Movimentados: false,
        Consultados: true,
        SomenteDisponiveis: true,
        PoliticaPreco: {
          CodigoPolitica: 0,
          PercentualSobrePrecoPublico: 0,
          PercentualSobrePrecoGarantia: 0,
          DescricaoPoliticaPreco: ''
        },
        CodigoDepartamento: 0,
        DataProcessamento: "",
        ListaIdProdutosFraga: [],
        FiltroCatalogo: {
          Pesquisa: "",
          Segmento: "",
          Montadora: "",
          Ano: "",
          Modelo: "",
          Versao: "",
          SistemaId: "",
          FraMarcaId: [],
          FragaIdProduto: "",
          Placa: ""
        },
        CodigoReferenciaFabrica: ""
      },
      {
        headers: {
          'Content-Type': 'application/json-patch+json',
          'Cache-Control': 'no-cache',
          'Ocp-Apim-Subscription-Key': 'e0b8910e002b4c7e9cd2ebfa2b9e7697',
          Ambiente: '02431719000102-BARAO-PRODUCAO',
          Authorization: ''
        }
      }
    );

    console.log('📄 Primeiros 10 itens retornados da Linx:', response.data.slice(0, 10));

    // Filtra apenas produtos com ItemEstoque preenchido
    const produtosValidos = response.data.filter(item => item.ItemEstoque);

    const mapped = produtosValidos.map(item => ({
      trayProductId: item.ItemEstoque,      // agora usamos ItemEstoque
      stock: item.QuantidadeDisponivel || 0
    }));

    console.log(`✅ Total de produtos válidos com ItemEstoque: ${mapped.length}`);
    return mapped;

  } catch (err) {
    console.error('❌ Erro ao buscar produtos da Linx:', err.message);
    if (err.response) {
      console.error('📦 Response da API Linx:', err.response.data);
    }
    return [];
  }
}
