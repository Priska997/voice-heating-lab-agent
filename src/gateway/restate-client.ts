export class RestateIngressClient {
  public constructor(private readonly baseUrl: string) {}

  public async invoke<TInput, TOutput>(handler: string, input: TInput): Promise<TOutput> {
    const response = await fetch(`${this.baseUrl}/HeatingTools/${handler}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new RestateIngressError(response.status, body);
    }

    return (await response.json()) as TOutput;
  }
}

export class RestateIngressError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly responseBody: string,
  ) {
    super(`Restate ingress returned ${statusCode}`);
  }
}
