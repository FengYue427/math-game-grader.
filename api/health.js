module.exports = (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.status(200).json({
    ok: true,
    service: "math-game-grader-proxy",
    version: "2026-05-07.1",
  });
};
