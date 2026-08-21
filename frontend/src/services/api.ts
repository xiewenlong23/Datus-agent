import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.response.use(
  response => response.data,
  error => {
    const message = error.response?.data?.detail || error.response?.data?.errorMessage || error.message
    return Promise.reject(new Error(message))
  },
)

export default api