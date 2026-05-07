import { normalizeCep, isValidCep } from "@/utils/zipCode";

const VIACEP_BASE_URL = "https://viacep.com.br/ws";

export interface ViaCepResponse {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  ibge: string;
  gia: string;
  ddd: string;
  siafi: string;
  erro?: boolean;
}

export const fetchAddressByCep = async (cep: string): Promise<Partial<ViaCepResponse>> => {
  const normalizedCep = normalizeCep(cep);

  if (!isValidCep(normalizedCep)) {
    throw new Error("CEP inválido");
  }

  try {
    const response = await fetch(`${VIACEP_BASE_URL}/${normalizedCep}/json/`);
    
    if (!response.ok) {
      throw new Error("Erro na consulta do CEP");
    }

    const data = await response.json();

    if (data.erro) {
      throw new Error("CEP não encontrado");
    }

    return data;
  } catch (error: any) {
    console.error("ViaCEP Error:", error);
    throw error;
  }
};
