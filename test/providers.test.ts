import type { AxiosRequestConfig } from "axios";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { ResolvedSendConfiguration } from "../src/index.js";

import {
  FarazSmsAdapter,
  GhasedakAdapter,
  IpPanelAdapter,
  KavenegarAdapter,
  type ProviderHttpClient,
  type ProviderHttpResponse,
} from "../src/providers/index.js";

class FakeHttpClient implements ProviderHttpClient {
  readonly requests: AxiosRequestConfig[] = [];

  constructor(private readonly responses: ProviderHttpResponse[]) {}

  async request(config: AxiosRequestConfig): Promise<ProviderHttpResponse> {
    this.requests.push(config);
    const response = this.responses.shift();
    if (response === undefined) throw new Error("No fake response configured.");
    return response;
  }
}

describe("provider adapter contracts", () => {
  it("fits concrete adapters into the generic orchestrator contract", () => {
    const configuration = {
      id: "configuration-1",
      version: 1,
      adapter: new GhasedakAdapter(new FakeHttpClient([])),
      credentials: { apiKey: "secret" },
      template: "template",
      bindings: [{ kind: "ordered", position: 1, sourceParameter: "code" }],
    } satisfies ResolvedSendConfiguration;
    expectTypeOf(configuration).toExtend<ResolvedSendConfiguration>();
  });

  it("sends Ghasedak ordered template parameters", async () => {
    const http = new FakeHttpClient([
      {
        status: 200,
        data: {
          IsSuccess: true,
          StatusCode: 200,
          Data: { MessageId: "gh-1" },
        },
      },
    ]);
    const result = await new GhasedakAdapter(http).sendTemplate(
      { apiKey: "secret" },
      {
        recipient: "+989123456789",
        template: "package-posted",
        parameters: ["T-1", "Ali"],
        clientReferenceId: "operation-1",
      },
      {},
    );

    expect(result).toEqual({ status: "accepted", providerMessageId: "gh-1" });
    expect(http.requests[0]).toMatchObject({
      method: "POST",
      url: "/rest/api/v1/WebService/SendOtpWithParams",
      headers: { ApiKey: "secret" },
      data: {
        receptors: ["09123456789"],
        templateName: "package-posted",
        clientReferenceId: "operation-1",
        param1: "T-1",
        param2: "Ali",
      },
    });
  });

  it("sends Kavenegar fixed token slots", async () => {
    const http = new FakeHttpClient([
      {
        status: 200,
        data: {
          return: { status: 200, message: "تایید شد" },
          entries: [{ messageid: 123 }],
        },
      },
    ]);
    const result = await new KavenegarAdapter(http).sendTemplate(
      { apiKey: "secret/key" },
      {
        recipient: "+989123456789",
        template: "package-posted",
        parameters: { token: "T-1", token2: "Ali" },
      },
      {},
    );

    expect(result).toEqual({ status: "accepted", providerMessageId: "123" });
    expect(http.requests[0]).toMatchObject({
      method: "GET",
      url: "/v1/secret%2Fkey/verify/lookup.json",
      params: {
        receptor: "09123456789",
        template: "package-posted",
        token: "T-1",
        token2: "Ali",
      },
    });
  });

  it("sends IPPanel named pattern parameters in E.164", async () => {
    const http = new FakeHttpClient([
      {
        status: 200,
        data: {
          meta: { status: true, message_code: "200-1" },
          data: { message_outbox_ids: [456] },
        },
      },
    ]);
    const result = await new IpPanelAdapter(http).sendTemplate(
      { apiToken: "token", fromNumber: "+983000505" },
      {
        recipient: "+989123456789",
        template: "pattern-code",
        parameters: { tracking: "T-1" },
      },
      {},
    );

    expect(result).toEqual({ status: "accepted", providerMessageId: "456" });
    expect(http.requests[0]).toMatchObject({
      method: "POST",
      url: "/v1/api/send",
      headers: { Authorization: "token" },
      data: {
        sending_type: "pattern",
        from_number: "+983000505",
        code: "pattern-code",
        recipients: ["+989123456789"],
        params: { tracking: "T-1" },
      },
    });
  });

  it("sends FarazSMS named pattern parameters in local format", async () => {
    const http = new FakeHttpClient([
      { status: 201, data: { status: "success", data: 789, messages: "sent" } },
    ]);
    const result = await new FarazSmsAdapter(http).sendTemplate(
      { apiKey: "key", lineNumber: "50002178584000" },
      {
        recipient: "+989123456789",
        template: "pattern-code",
        parameters: { tracking: "T-1" },
      },
      {},
    );

    expect(result).toEqual({ status: "accepted", providerMessageId: "789" });
    expect(http.requests[0]).toMatchObject({
      method: "POST",
      url: "/ws/v1/sms/pattern",
      headers: { "Api-Key": "key" },
      data: {
        code: "pattern-code",
        attributes: { tracking: "T-1" },
        recipient: "09123456789",
        line_number: "50002178584000",
        number_format: "english",
      },
    });
  });

  it("uses only read-only operations for credential verification", async () => {
    const cases = [
      {
        adapter: new GhasedakAdapter(
          new FakeHttpClient([
            { status: 200, data: { IsSuccess: true, StatusCode: 200 } },
          ]),
        ),
        credentials: { apiKey: "key" },
      },
      {
        adapter: new KavenegarAdapter(
          new FakeHttpClient([
            {
              status: 200,
              data: { return: { status: 200, message: "ok" }, entries: [] },
            },
          ]),
        ),
        credentials: { apiKey: "key" },
      },
    ] as const;

    for (const item of cases) {
      await expect(
        item.adapter.verifyCredentials(item.credentials, {}),
      ).resolves.toMatchObject({
        status: "verified",
      });
    }
  });

  it("treats malformed success responses as unknown outcomes", async () => {
    const http = new FakeHttpClient([
      { status: 200, data: { unexpected: true } },
    ]);
    await expect(
      new IpPanelAdapter(http).sendTemplate(
        { apiToken: "token", fromNumber: "+983000505" },
        {
          recipient: "+989123456789",
          template: "pattern",
          parameters: { code: "1" },
        },
        {},
      ),
    ).resolves.toEqual({ status: "unknown", code: "unknown_outcome" });
  });

  it("classifies malformed 401 responses as invalid credentials", async () => {
    const http = new FakeHttpClient([{ status: 401, data: "Unauthorized" }]);
    await expect(
      new GhasedakAdapter(http).verifyCredentials({ apiKey: "bad" }, {}),
    ).resolves.toEqual({ status: "invalid", code: "invalid_credentials" });
  });
});
