import { fetchAddressByCep as fetchNormalizedAddress, ViaCepError } from "@/services/viacep";
import { isValidCep, normalizeCep } from "@/utils/zipCode";

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
  lat?: number;
  lng?: number;
  erro?: boolean;
}

export const fetchAddressByCep = async (cep: string): Promise<Partial<ViaCepResponse>> => {
  const normalizedCep = normalizeCep(cep);

  if (!isValidCep(normalizedCep)) {
    throw new Error("CEP invalido");
  }

  try {
    const address = await fetchNormalizedAddress(normalizedCep);

    return {
      cep: address.cep,
      logradouro: address.street,
      complemento: address.complement ?? "",
      bairro: address.neighborhood,
      localidade: address.city,
      uf: address.state,
      ibge: address.ibgeCode ?? "",
      gia: "",
      ddd: address.ddd ?? "",
      siafi: "",
      lat: address.lat,
      lng: address.lng,
    };
  } catch (error) {
    if (error instanceof ViaCepError) {
      throw new Error(error.message);
    }
    throw error;
  }
};
