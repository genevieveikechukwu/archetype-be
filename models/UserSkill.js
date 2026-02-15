const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const UserSkill = sequelize.define(
    "UserSkill",
    {
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: { model: "users", key: "id" },
      },
      skill_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: { model: "skills", key: "id" },
      },
      level: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 0,
      },
      courses_completed: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      test_average: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      supervisor_rating: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      last_calculated: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "user_skills",
      timestamps: false,
    },
  );

  return UserSkill;
};
