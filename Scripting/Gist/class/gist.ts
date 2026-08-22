import { fetch, RequestInit } from "scripting";

class Gist {
  private KEY = "gist";
  token: string = Storage.get(this.KEY) || "";

  save() {
    Storage.set(this.KEY, this.token);
  }

  async get() {
    return await this.fetch("https://api.github.com/gists");
  }

  async getUser() {
    return await this.fetch("https://api.github.com/user");
  }

  // --- api --- //
  async create(filename: string, content: string, isPublic: boolean, description: string) {
    return await this.fetch("https://api.github.com/gists", {
      method: "POST",
      body: JSON.stringify({
        description: description,
        public: isPublic,
        files: {
          [filename]: {
            content: content,
          },
        },
      }),
    });
  }

  async updateContent(url: string, filename: string, content: string) {
    return await this.fetch(url, {
      method: "PATCH",
      body: JSON.stringify({
        files: {
          [filename]: {
            content: content,
          },
        },
      }),
    });
  }

  async deleteContent(url: string, filename: string) {
    return await this.fetch(url, {
      method: "PATCH",
      body: JSON.stringify({
        files: {
          [filename]: null,
        },
      }),
    });
  }

  async updateDescription(url: string, description: string) {
    return await this.fetch(url, {
      method: "PATCH",
      body: JSON.stringify({
        description: description,
      }),
    });
  }

  async getContent(url: string) {
    return await fetch(url, {
      method: "GET",
      // body: JSON.stringify({
      //   gist_id: url.split("/").pop() || "",
      // }),
    }).then((r) => r.text());
  }

  async delete(url: string) {
    return await this.fetch(url, {
      method: "DELETE",
    });
  }

  // --- util --- //
  private async fetch(url: string, init?: RequestInit) {
    return await fetch(url, {
      ...init,
      headers: {
        ...init?.headers,
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
      },
    }).then((r) => {
      if (!r.ok) throw r.statusText;
      return r.json();
    });
  }
}

export const gist = new Gist();
