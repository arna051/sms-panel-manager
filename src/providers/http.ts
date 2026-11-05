import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";

export interface ProviderHttpResponse {
  readonly status: number;
  readonly data: unknown;
}

export interface ProviderHttpClient {
  request(config: AxiosRequestConfig): Promise<ProviderHttpResponse>;
}

class AxiosProviderHttpClient implements ProviderHttpClient {
  constructor(private readonly instance: AxiosInstance) {}

  async request(config: AxiosRequestConfig): Promise<ProviderHttpResponse> {
    const response: AxiosResponse<unknown> =
      await this.instance.request(config);
    return { status: response.status, data: response.data };
  }
}

export function createProviderHttpClient(options: {
  readonly baseURL: string;
  readonly timeoutMs?: number;
}): ProviderHttpClient {
  const url = new URL(options.baseURL);
  if (url.protocol !== "https:") {
    throw new TypeError("Provider base URL must use HTTPS.");
  }
  const timeout = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new TypeError("Provider timeout must be a positive integer.");
  }

  return new AxiosProviderHttpClient(
    axios.create({
      baseURL: url.toString(),
      timeout,
      maxRedirects: 0,
      responseType: "json",
      validateStatus: () => true,
      headers: { Accept: "application/json" },
    }),
  );
}
