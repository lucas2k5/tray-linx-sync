import axios from 'axios';
import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';
import type { LinxStockApiItem, NormalizedStockItem } from '../../types/linx.js';

const LINX_HEADERS = {
  'Content-Type': 'application/json-patch+json',
  'Cache-Control': 'no-cache',
  'Ocp-Apim-Subscription-Key': env.LINX_SUBSCRIPTION_KEY,
  Ambiente: env.LINX_AMBIENTE,
  Authorization: '',
};

const CONSULTA_BODY = {
  ConfiguracaoBase: {
    Empresa: 1,
    Revenda: 1,
    Usuario: 0,
    CodigoOrigem: 0,
    IdentificadorOrigem: '',
    ClienteContactado: false,
  },
  TextoPesquisa: '',
  CodigoItemParcial: '',
  CodigoEanGtin: '',
  DescricaoItemParcial: '',
  UtilizacaoItemParcial: '',
  GruposPecas: '',
  Marcas: '',
  ListaFornecedoresDSH: '',
  TipoPesquisa: 'I',
  ClasseFabrica: '',
  TipoTransacao: 'P21',
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
    DescricaoPoliticaPreco: '',
  },
  CodigoReferenciaFabrica: '',
};

export async function fetchStockFromLinx(): Promise<NormalizedStockItem[]> {
  try {
    const response = await axios.post<LinxStockApiItem[]>(
      `${env.LINX_API_URL}/api-e-commerce-premium/ConsultaPecaGerencial`,
      CONSULTA_BODY,
      { headers: LINX_HEADERS }
    );

    const items = response.data;
    logger.debug({ count: items.length }, 'Itens brutos recebidos da Linx');

    const valid = items
      .filter((item) => Boolean(item.ItemEstoque))
      .map((item) => ({
        trayProductId: item.ItemEstoque as string,
        stock: item.QuantidadeDisponivel ?? 0,
      }));

    logger.info({ total: valid.length }, 'Produtos válidos com ItemEstoque');
    return valid;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'Erro ao buscar estoque da Linx');
    return [];
  }
}
