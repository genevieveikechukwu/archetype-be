const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const LearningSession = sequelize.define(
    "LearningSession",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      start_time: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      end_time: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      duration_minutes: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      reflection_text: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
    },
    {
      tableName: "learning_sessions",
      timestamps: false,
    },
  );

  return LearningSession;
};
