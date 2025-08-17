const isDev = () => {
  return process.env.NODE_ENV === "development";
}

export default isDev