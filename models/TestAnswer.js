const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const TestAnswer = sequelize.define(
    "TestAnswer",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      attempt_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "test_attempts", key: "id" },
      },
      question_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "test_questions", key: "id" },
      },
      answer_text: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      selected_option_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "question_options", key: "id" },
      },
      points_awarded: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      feedback: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "test_answers",
      timestamps: false,
    },
  );

  return TestAnswer;
};
