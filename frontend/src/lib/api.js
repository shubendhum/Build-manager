import axios from "axios";

const api = axios.create({
  baseURL: `${process.env.REACT_APP_BACKEND_URL}/api`,
  withCredentials: true,
});

let onUnauthorized = null;
export const setOnUnauthorized = (fn) => { onUnauthorized = fn; };

let refreshPromise = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config || {};
    const status = error.response?.status;
    const url = original.url || "";
    if (status === 401 && !original._retry && !url.includes("/auth/")) {
      original._retry = true;
      try {
        refreshPromise = refreshPromise || api.post("/auth/refresh");
        await refreshPromise;
        refreshPromise = null;
        return api(original);
      } catch (e) {
        refreshPromise = null;
        if (onUnauthorized) onUnauthorized();
      }
    }
    return Promise.reject(error);
  }
);

export const formatApiErrorDetail = (detail) => {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).filter(Boolean).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
};

// Extract an error message from a failed blob (file download) request
export const readBlobError = async (error) => {
  try {
    const data = error.response?.data;
    if (data instanceof Blob) {
      const parsed = JSON.parse(await data.text());
      return formatApiErrorDetail(parsed.detail);
    }
    return formatApiErrorDetail(data?.detail);
  } catch {
    return "Download failed. Please try again.";
  }
};

export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export default api;
