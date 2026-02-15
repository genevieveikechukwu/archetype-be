const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Test = sequelize.define(
    "Test",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      course_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "courses", key: "id" },
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      test_type: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          isIn: [["multiple_choice", "written", "coding"]],
        },
      },
      passing_score: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 70,
      },
      time_limit_minutes: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      max_attempts: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 3,
      },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
    },
    {
      tableName: "tests",
      timestamps: false,
    },
  );

  return Test;
};
