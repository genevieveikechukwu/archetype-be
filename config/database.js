const { sequelize, ...models } = require("../models");

// Re-export sequelize instance and all models for convenience
module.exports = {
  sequelize,
  ...models,
};
