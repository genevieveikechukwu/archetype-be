const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Skill = sequelize.define(
    "Skill",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "skills",
      timestamps: false,
    },
  );

  return Skill;
};
